import { API, Server } from '../src/index';
import { RedisClient } from 'redis';
import { Logger } from '@vigcoin/logger';
import { PoolRequest } from '@vigcoin/pool-request';
import { Charts } from '@vigcoin/pool-charts';
import { promisify } from 'util';
import { Response } from 'express';
import * as express from 'express';
import * as request from 'supertest';
import * as nock from 'nock';

const app = express();
const app1 = express();
const app2 = express();
const config = require('./config.json');

const redis = new RedisClient({});
const logger = new Logger(config.logger);
const pr = new PoolRequest(config.daemon, config.wallet, config.api);
const api = new API(config, logger, pr);

app.get('/test1', function(req, res) {
  api.addAddressesConnection('aaa', res);
});

app.get('/test2', function(req, res) {
  api.addAddressesConnection('eee', res);
});

app.get('/test3', function(req, res) {
  api.addAddressesConnection('uuu', null);
});

test('Should have api', () => {
  expect(api).toBeTruthy();
});

test('Should flush all', done => {
  redis.flushall((err, succeeded) => {
    expect(!err).toBeTruthy();
    expect(succeeded).toBeTruthy();
    done();
  });
});

test('Should get address status', async () => {
  let res = await api.getAddressStatus(redis, config.coin, 'bbb');
  expect(Object.keys(res).length === 0).toBeTruthy();
});

test('set blocks data', async () => {
  const hset = promisify(redis.hset).bind(redis);
  await hset(config.coin + ':workers:aaa', 'user', 100);
  await hset(config.coin + ':workers:aaa', 'user', 100);
  await hset(config.coin + ':workers:aaa', 'user', 0);
  await hset(config.coin + ':workers:ccc', 'bbb', 0);
  await hset(config.coin + ':workers:ccc', 'bbb', 0);
  await hset(config.coin + ':workers:ccc', 'bbb', 0);
});

test('Should get address status', async () => {
  let res = await api.getAddressStatus(redis, config.coin, 'aaa');
  expect(Object.keys(res).length > 0).toBeTruthy();
});

test('Should get hashrate', async () => {
  let hr = await api.getReadableHashRateString(1);
  let hr1 = await api.getReadableHashRateString(1000);
  let hr11 = await api.getReadableHashRateString(1100);
  let hr2 = await api.getReadableHashRateString(1000 * 1000);
  let hr3 = await api.getReadableHashRateString(1000 * 1000 * 1000);
  let hr4 = await api.getReadableHashRateString(1000 * 1000 * 1000 * 1000);
  let hr5 = await api.getReadableHashRateString(
    1000 * 1000 * 1000 * 1000 * 1000
  );
  expect(hr === '1.00 H').toBeTruthy();
  expect(hr1 === '1.00 KH').toBeTruthy();
  expect(hr11 === '1.10 KH').toBeTruthy();
  expect(hr2 === '1.00 MH').toBeTruthy();
  expect(hr3 === '1.00 GH').toBeTruthy();
  expect(hr4 === '1.00 TH').toBeTruthy();
  expect(hr5 === '1.00 PH').toBeTruthy();
});

test('Should get port', async () => {
  let res = await api.getPublicPorts([{ hidden: true }, { hidden: false }]);
  expect(Object.keys(res).length === 1).toBeTruthy();
});

test('Should broadcastLiveStats ', async () => {
  let res = await api.broadcastLiveStats(redis, config);
  console.log(res);
});

test('Should broadcastLiveStats ', done => {
  let a = false,
    b = false;

  let interval = setInterval(async () => {
    if (a && b) {
      clearInterval(interval);
      done();
    }
    await api.broadcastLiveStats(redis, config);
  }, 100);
  request(app)
    .get('/test1')
    .then(res => {
      console.log('responsed');
      console.log('a');
      a = true;
    });

  request(app)
    .get('/test2')
    .then(res => {
      console.log('responsed');
      console.log('b');
      b = true;
    });

  request(app)
    .get('/test3')
    .then(res => {});
});

test('Should collectStatus ', done => {
  console.log('inside collect 1');
  const charts = new Charts(config, pr, logger);
  api.collectStatus(charts, redis, {}, '1.0').then(() => {
    setTimeout(() => {
      done();
    }, 500);
  });
});

test('should adjust data', async () => {
  var dateNow = Date.now();
  var dateNowSeconds = (dateNow / 1000) | 0;

  const hset = promisify(redis.hset).bind(redis);
  const zadd = promisify(redis.zadd).bind(redis);
  await hset(config.coin + ':stats', 'lastBlockFound', 1001);
  await hset(config.coin + ':shares:roundCurrent', '', 1001);
  await hset(config.coin + ':shares:roundCurrent', '', 1002);
  await zadd(
    config.coin + ':hashrate',
    dateNowSeconds,
    [1000, 'aa', dateNow].join(':')
  );
  await zadd(
    config.coin + ':hashrate',
    dateNowSeconds + 1,
    [1000, 'aa', dateNow].join(':')
  );
  await zadd(
    config.coin + ':hashrate',
    dateNowSeconds + 2,
    [1000, 'aa', dateNow].join(':')
  );
});

test('Should collectStatus ', done => {
  console.log('inside collect 1');
  const charts = new Charts(config, pr, logger);
  api.collectStatus(charts, redis, {}, '1.0').then(() => {
    setTimeout(() => {
      done();
    }, 500);
  });
});

test('should adjust data', async () => {
  config.poolServer.slushMining.enabled = true;
});

test('Should collectStatus ', done => {
  console.log('inside collect 1');
  const charts = new Charts(config, pr, logger);
  api.collectStatus(charts, redis, {}, '1.0').then(() => {
    setTimeout(() => {
      done();
    }, 500);
  });
});

test('should ini daemon network server', done => {
  app1.all('*', (req, res) => {
    console.log('inside resource ');
    res.json({
      error: 'ok',
      difficulty: 1,
      height: 2,
      timestamp: 3,
      reward: 4,
      hash: 5,
    });
  });
  const config = require('./config.json');
  app1.listen(config.daemon.port, () => {
    done();
  });
});

test('should ini wallet network server', done => {
  app2.all('*', (req, res) => {
    console.log('inside resource ');
    res.json({
      error: 'ok',
      difficulty: 1,
      height: 2,
      timestamp: 3,
      reward: 4,
      hash: 5,
    });
  });
  const config = require('./config.json');
  app2.listen(config.wallet.port, () => {
    done();
  });
});

test('should init rpc monitoring', done => {
  api.initMonitoring(redis).then(() => {
    setTimeout(() => {
      api.clearIntervals();
      done();
    }, 1000);
  });
});

test('should init rpc monitoring', done => {
  config.monitoring.daemon.checkInterval = 0;
  config.monitoring.wallet.checkInterval = 0;
  api.initMonitoring(redis).then(() => {
    setTimeout(() => {
      api.clearIntervals();
      done();
    }, 1000);
  });
});

test('should init rpc monitoring', () => {
  api.setHashrate('aaa', 0);
  const hr = api.getHashrate('aaa');
  expect(hr).toBe(0);
  api.setHashrate('aaa', 1);
  const hr1 = api.getHashrate('aaa');
  expect(hr1).toBe(1);
});

test('should ini daemon network', async () => {
  console.log('app started!');
  const data = await api.getNetwork(redis);
  expect(data.error).toBeFalsy();
  expect(data.difficulty).toBe(1);
  expect(data.height).toBe(2);
  expect(data.timestamp).toBe(3);
  expect(data.reward).toBe(4);
  expect(data.hash).toBe(5);
});

test('Should close all', () => {
  api.clearTimer();
  redis.quit();
});
