import { Router, Request, Response } from "express";
import { v1 as uuid } from "uuid";
import { promisify } from "util";
import { RedisClient } from "redis";
import * as _ from "lodash";
import { Logger } from "@vigcoin/logger";
import { PoolRequest } from "@vigcoin/pool-request";

export class API {
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
  private addressConnections = {};

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

  async collectStatus(redis: RedisClient) {
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
    const replies = await multi()
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
    if (Object.keys(status).length) {
      status.hashrate = this.minerStats[address];
      return status;
    }
    return {};
  }

  async getAddressPayments(redis: RedisClient, coin: string, address: string) {
    const zrevrange = promisify(redis.zrevrange).bind(redis);
    return zrevrange([coin, 'payments', address].join(':'));
  }

  getHashrate(address: string) {
    return this.minersHashrate[address] ? this.minersHashrate[address] : 0;
  }

  getHashrates() {
    return this.minersHashrate;
  }

}