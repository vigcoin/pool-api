import { API, Server } from '../src/index';
import { Router, Request, Response, Application } from "express";
import * as express from "express";
import { RedisClient } from "redis";
import { Charts } from "@vigcoin/pool-charts";
import { Logger } from "@vigcoin/logger";
import { PoolRequest } from "@vigcoin/pool-request";

const app: Application = express();
const port = parseInt((Math.random() * 10000).toFixed(0)) + 1024;

const config = require('./config.json');

const pr = new PoolRequest(
  {},
  {},
  {
    host: 'localhost',
    port,
  }
);

const pr1 = new PoolRequest(
  {},
  {},
  {
    host: 'localhost',
    port: port + 1,
  }
);
const logger = new Logger({});
const redis = new RedisClient({});
const api = new API(config, logger, pr);
const charts = new Charts(
  {
    pool: {
      hashrate: {
        enabled: true,
        updateInterval: 0.1,
        stepInterval: 1800,
        maximumPeriod: 86400,
      },
      workers: {
        enabled: true,
        updateInterval: 0.1,
        stepInterval: 1800,
        maximumPeriod: 86400,
      },
      difficulty: {
        enabled: true,
        updateInterval: 0.1,
        stepInterval: 10800,
        maximumPeriod: 604800,
      },
      price: {
        enabled: true,
        updateInterval: 0.1,
        stepInterval: 10800,
        maximumPeriod: 604800,
      },
      profit: {
        enabled: true,
        updateInterval: 0.1,
        stepInterval: 10800,
        maximumPeriod: 604800,
      },
    },

    user: {
      hashrate: {
        enabled: true,
        updateInterval: 0.1,
        setInterval: 0,
        maximumPeriod: 0,
      },
    },
  },
  pr,
  logger
);

test('Should greet with message', () => {
  const server = new Server(app, config, redis);
  expect(server).toBeTruthy();
});

test('Should close all', () => {
  redis.quit();
});
