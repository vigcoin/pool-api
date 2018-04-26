import { API, Server } from '../src/index';
import { Router, Request, Response, Application } from "express";
import * as express from "express";
import { RedisClient } from "redis";
import { Charts } from "@vigcoin/pool-charts";
import { Logger } from "@vigcoin/logger";
import { PoolRequest } from "@vigcoin/pool-request";

const request = require('supertest');

const app: Application = express();
const app1: Application = express();
const port = parseInt((Math.random() * 10000).toFixed(0)) + 1024;

const config = require('./config.json');
const redis = new RedisClient({});
const server = new Server(app, config, redis, {}, '1.0');
let http: any;

test('Should create server', () => {
  expect(server).toBeTruthy();
});

test('Should start', async () => {
  http = await server.start()
  expect(http).toBeTruthy();
});

test('Should app get stats', () => {
  return request(app)
    .get('/stats').expect(200);
});

test('Should app get live stats', (done) => {
  let api = server.getApi();
  request(app)
    .get('/live_stats').then((res) => {
      expect(res.statusCode).toBe(200);
      done();
    });
  setTimeout(() => {
    api.sendConnections();
  }, 100);
});

// test('Should app get stats', (done) => {
//   request(app)
//     .get('/stats_address')
//     .expect(200)
//     .end(done);
// });

// test('Should app get stats', (done) => {
//   request(app)
//     .get('/get_payments')
//     .expect(200)
//     .end(done);
// });

// test('Should app get stats', (done) => {
//   request(app)
//     .get('/get_blocks')
//     .expect(200)
//     .end(done);
// });

// test('Should app get stats', (done) => {
//   request(app)
//     .get('/admin_stats')
//     .expect(200)
//     .end(done);
// });

// test('Should app get stats', (done) => {
//   request(app)
//     .get('/admin_monitoring')
//     .expect(200)
//     .end(done);
// });

// test('Should app get stats', (done) => {
//   request(app)
//     .get('/admin_log')
//     .expect(200)
//     .end(done);
// });

// test('Should app get stats', (done) => {
//   request(app)
//     .get('/admin_users')
//     .expect(200)
//     .end(done);
// });

// test('Should app get stats', (done) => {
//   request(app)
//     .get('/miners_hashrate')
//     .expect(200)
//     .end(done);
// });

test('Should quit server', () => {
  http.close();
});

test('Should close all', () => {
  redis.quit();
});
