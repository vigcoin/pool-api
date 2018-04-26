import { Router, Request, Response } from "express";
import { v1 as uuid } from "uuid";
import { promisify } from "util";
import { RedisClient } from "redis";
import * as _ from "lodash";
import { Logger } from "@vigcoin/logger";
import { PoolRequest } from "@vigcoin/pool-request";
import { Charts } from "@vigcoin/pool-charts";
import * as zlib from "zlib";

export class API {
  private timer: NodeJS.Timer;
  private logger: Logger;
  private req: PoolRequest | any;
  private config: any;
  private coin: string;
  private redisCommands = {};
  private currentStats = "";
  private currentStatsCompressed = "";

  private minerStats: any = {};
  private minersHashrate: any = {};

  private liveConnections: any = {};
  private addressConnections: any = {};

  constructor(config: any, logger: Logger, req: PoolRequest) {
    this.req = req;
    this.logger = logger;
    this.initRedisCommand(config);
  }

  initRedisCommand(config: any) {
    this.config = config;
    const coin = config.coin;
    this.coin = coin;
    const blocks = config.api.blocks;
    const payments = config.api.payments;
    this.redisCommands = [
      ['zremrangebyscore', coin + ':hashrate', '-inf', ''],
      ['zrange', coin + ':hashrate', 0, -1],
      ['hgetall', coin + ':stats'],
      ['zrange', coin + ':blocks:candidates', 0, -1, 'WITHSCORES'],
      ['zrevrange', coin + ':blocks:matured', 0, blocks - 1, 'WITHSCORES'],
      ['hgetall', coin + ':shares:roundCurrent'],
      ['hgetall', coin + ':stats'],
      ['zcard', coin + ':blocks:matured'],
      ['zrevrange', coin + ':payments:all', 0, payments - 1, 'WITHSCORES'],
      ['zcard', coin + ':payments:all'],
      ['keys', coin + ':payments:*']
    ];
  }

  async initMonitoring(redis: RedisClient) {
    for (const module of Object.keys(this.config.monitoring)) {
      let settings = _.get(this.config, 'monitoring.' + module);
      if (settings.checkInterval) {
        await this.startRpcMonitoring(redis, module, settings.rpcMethod, settings.checkInterval);
      }
    }
  }

  async startRpcMonitoring(redis: RedisClient, module: string, method: string, interval: number) {
    setInterval(async () => {
      const json = await this.req[module](method, {});

      const stat: any = {
        lastCheck: Date.now() / 1000,
        lastStatus: 'ok',
        lastResponse: JSON.stringify(json)
      };
      const key = [this.coin, 'status', module].join(':');
      const redisCommands = [];
      for (const property of Object.keys(stat)) {
        redisCommands.push(['hset', key, property, stat[property]]);
      }
      const multi = promisify(redis.multi).bind(redis);
      await multi(redisCommands);
    }, interval * 1000);
  }

  async getPool(redis: RedisClient) {
    let config = this.config;
    let blocks = _.get(this.config, 'api.blocks');
    let hashrateWindow = _.get(this.config, 'api.hashrateWindow');
    let payments = _.get(this.config, 'api.payments');
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    let coin = this.coin;
    let redisCommands = [
      ['zremrangebyscore', coin + ':hashrate', '-inf', '(' + windowTime],
      ['zrange', coin + ':hashrate', 0, -1],
      ['hgetall', coin + ':stats'],
      ['zrange', coin + ':blocks:candidates', 0, -1, 'WITHSCORES'],
      ['zrevrange', coin + ':blocks:matured', 0, blocks - 1, 'WITHSCORES'],
      ['hgetall', coin + ':shares:roundCurrent'],
      ['hgetall', coin + ':stats'],
      ['zcard', coin + ':blocks:matured'],
      ['zrevrange', coin + ':payments:all', 0, payments - 1, 'WITHSCORES'],
      ['zcard', coin + ':payments:all'],
      ['keys', coin + ':payments:*']
    ];

    const multi = promisify(redis.multi).bind(redis);
    const replies = await multi(redisCommands);
    let redisFinished = Date.now();
    const dateNowSeconds = Date.now() / 1000 | 0;

    const data: any = {
      stats: replies[2],
      blocks: replies[3].concat(replies[4]),
      totalBlocks: parseInt(replies[7]) + (replies[3].length / 2),
      payments: replies[8],
      totalPayments: parseInt(replies[9]),
      totalMinersPaid: replies[10].length - 1
    };

    const hashrates = replies[1];

    this.minerStats = {};
    this.minersHashrate = {};

    for (let i = 0; i < hashrates.length; i++) {
      const hashParts = hashrates[i].split(':');
      this.minersHashrate[hashParts[1]] = (this.minersHashrate[hashParts[1]] || 0) + parseInt(hashParts[0]);
    }

    let totalShares = 0;

    for (const miner in this.minersHashrate) {
      const shares = this.minersHashrate[miner];
      totalShares += shares;
      this.minersHashrate[miner] = Math.round(shares / config.api.hashrateWindow);
      this.minerStats[miner] = this.getReadableHashRateString(this.minersHashrate[miner]);
    }

    data.miners = Object.keys(this.minerStats).length;

    data.hashrate = Math.round(totalShares / config.api.hashrateWindow);

    data.roundHashes = 0;

    if (replies[5]) {
      for (const miner in replies[5]) {
        if (config.poolServer.slushMining.enabled) {
          data.roundHashes += parseInt(replies[5][miner]) / Math.pow(Math.E, ((data.lastBlockFound - dateNowSeconds) / config.poolServer.slushMining.weight)); //TODO: Abstract: If something different than lastBlockfound is used for scoreTime, this needs change. 
        }
        else {
          data.roundHashes += parseInt(replies[5][miner]);
        }
      }
    }

    if (replies[6]) {
      data.lastBlockFound = replies[6].lastBlockFound;
    }
    return data;
  }

  async getNetwork(redis: RedisClient) {
    try {
      let data = await this.req.daemon('', 'getlastblockheader', {});
      let blockHeader = data.block_header;
      return _.pick(data, ['difficulty', 'height', 'timestamp', 'reward', 'hash'])
    } catch (e) {
      this.logger.append('error', 'api', 'Error getting daemon data ' + e, []);
      return null;
    }
  }

  async collectStatus(charts: Charts, redis: RedisClient, donations: any, version: string) {
    let startTime = Date.now();
    let config = this.config;
    let pool = await this.getPool(redis);
    let redisFinished = Date.now();
    let network = await this.getNetwork(redis);
    let daemonFinished = Date.now();
    let modConfig = {
      ports: this.getPublicPorts(config.poolServer.ports),
      hashrateWindow: config.api.hashrateWindow,
      fee: config.blockUnlocker.poolFee,
      coin: config.coin,
      coinUnits: config.coinUnits,
      coinDifficultyTarget: config.coinDifficultyTarget,
      symbol: config.symbol,
      depth: config.blockUnlocker.depth,
      donation: donations,
      version: version,
      minPaymentThreshold: config.payments.minPayment,
      denominationUnit: config.payments.denomination,
      blockTime: config.coinDifficultyTarget,
      slushMiningEnabled: config.poolServer.slushMining.enabled,
      weight: config.poolServer.slushMining.weight
    };
    let result = {
      pool: pool,
      network: network,
      config: modConfig,
      charts: await charts.getPoolChartsData(redis, config.coin)
    };

    this.logger.append('info', 'api', 'Stat collection finished: ' + (redisFinished - startTime) + 'ms redis, ' + (daemonFinished - startTime) + ' ms daemon', []);
    this.currentStats = JSON.stringify(result);
    let deflateRaw = promisify(zlib.deflateRaw).bind(zlib);
    this.currentStatsCompressed = await deflateRaw(this.currentStats);
    await this.broadcastLiveStats(redis, this.config);
    this.clearTimer();
    this.timer = setTimeout(async () => {
      await this.collectStatus(charts, redis, donations, version);
    }, config.api.updateInterval * 1000);
  }

  public clearTimer() {
    clearTimeout(this.timer);
  }

  sendConnections() {
    for (let uid of Object.keys(this.liveConnections)) {
      const res = this.liveConnections[uid];
      res.end(this.currentStatsCompressed);
    }
  }

  async sendAddresses(redis: RedisClient, config: any) {
    var redisCommands = [];
    for (let address in this.addressConnections) {
      redisCommands.push(['hgetall', config.coin + ':workers:' + address]);
      redisCommands.push(['zrevrange', config.coin + ':payments:' + address, 0, config.api.payments - 1, 'WITHSCORES']);
    }

    let multi = promisify(redis.multi).bind(redis);
    console.log("before multi");
    let replies = await multi(redisCommands);
    console.log("after multi");

    let addresses = Object.keys(this.addressConnections);
    addresses.forEach((address, i) => {
      var offset = i * 2;
      var stats = replies[offset];
      var res = this.addressConnections[address];
      if (!stats) {
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      stats.hashrate = this.minerStats[address];
      res.end(JSON.stringify({ stats: stats, payments: replies[offset + 1] }));
    });
  }

  async broadcastLiveStats(redis: RedisClient, config: any) {
    this.logger.append('info', 'api', 'Broadcasting to ' + Object.keys(this.liveConnections).length + ' visitors and '
      + Object.keys(this.addressConnections).length +
      ' address lookups', []);

    this.sendConnections();
    await this.sendAddresses(redis, config);

  }
  getPublicPorts(ports: any) {
    return ports.filter(function (port: any) {
      return !port.hidden;
    });
  }

  getReadableHashRateString(hashrate: number) {
    let i = 0;
    const byteUnits = [' H', ' KH', ' MH', ' GH', ' TH', ' PH'];
    while (hashrate > 1000) {
      hashrate = hashrate / 1000;
      i++;
    }
    return hashrate.toFixed(2) + byteUnits[i];
  }

  getCurrentStatus(compressed: boolean) {
    return compressed ? this.currentStatsCompressed : this.currentStats;
  }

  addConnection(res: Response) {
    const id = uuid();
    this.liveConnections[id] = res;
    res.on("finish", () => {
      delete this.liveConnections[id];
    });
  }

  async getAddressStatus(redis: RedisClient, coin: string, address: string) {
    const hgetall = promisify(redis.hgetall).bind(redis);
    let status = await hgetall([coin, 'workers', address].join(':'));
    if (status && Object.keys(status).length) {
      status.hashrate = this.minerStats[address];
      return status;
    }
    return {};
  }

  async getAddressPayments(redis: RedisClient, coin: string, address: string) {
    let payments = _.get(this.config, 'api.payments');
    const zrevrange = promisify(redis.zrevrange).bind(redis);
    return zrevrange([coin, 'payments', address].join(':'), 0, payments - 1, 'WITHSCORES');
  }

  getHashrate(address: string) {
    return this.minersHashrate[address] ? this.minersHashrate[address] : 0;
  }

  getHashrates() {
    return this.minersHashrate;
  }

}