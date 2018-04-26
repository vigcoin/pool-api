import { API, Server } from '../src/index';
import { Router, Request, Response, Application } from "express";
import * as express from "express";
import { RedisClient } from "redis";
import { Charts } from "@vigcoin/pool-charts";
import { Logger } from "@vigcoin/logger";
import { PoolRequest } from "@vigcoin/pool-request";
import * as fs from "fs";
import * as path from "path";

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

test('Should app address stats', () => {
    return request(app)
        .get('/stats_address').expect(403);
});

test('Should app address stats 2', () => {
    return request(app)
        .get('/stats_address').query({ address: 'aaa', longpoll: false }).expect(200);
});

test('Should get payments all', () => {
    return request(app)
        .get('/get_payments').query({ time: Date.now() }).expect(200);
});

test('Should get payments address', () => {
    return request(app)
        .get('/get_payments').query({ address: 'aaa', time: Date.now() }).expect(200);
});


test('Should get blocks', () => {
    return request(app)
        .get('/get_blocks').query({ time: Date.now() }).expect(200);
});

test('Should get admin status failed', () => {
    return request(app)
        .get('/admin_stats').query({ time: Date.now() }).expect(401);
});

test('Should get admin status ok', () => {
    return request(app).get('/admin_stats').query({ password: 1234 }).expect(200);
});

test('Should get admin monitoring', () => {
    return request(app).get('/admin_monitoring').query({ password: 1234 }).expect(200);
});


test('Should get admin log  none exist', () => {
    return request(app).get('/admin_log').query({ password: 1234, file: 'aaa.txt' }).expect(403);
});

test('Should get admin log', (done) => {
    let file = fs.createWriteStream(path.resolve(__dirname, '../logs/bbb.log'));
    file.write("hello");
    file.end(() => {
        request(app).get('/admin_log').query({ password: 1234, file: 'bbb.log' }).expect(200).then(() => {
            done();
        })
    });
    file.close();

});

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
    fs.unlinkSync(path.resolve(__dirname, '../logs/bbb.log'));
    http.close();
});

test('Should close all', () => {
    redis.quit();
});
