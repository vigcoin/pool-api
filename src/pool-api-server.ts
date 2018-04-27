import * as express from "express";
import { Router, Request, Response, Application } from "express";
import * as cors from "cors";
import * as _ from "lodash";
import { API } from "./pool-api";
import { Charts } from "@vigcoin/pool-charts";
import { RedisClient } from "redis";
import { promisify } from "util";
import * as cookiesParser from "cookie-parser";
import { Logger } from "@vigcoin/logger";
import { PoolRequest } from "@vigcoin/pool-request";
import * as fs from "fs";


export class Server {
    private server: any;
    private app: Application;
    private pr: PoolRequest;
    private config: any;
    private port = 80;
    private api: API;
    private redis: RedisClient;
    private charts: Charts;
    private logger: Logger;
    private donations: any;
    private version: string;

    constructor(app: Application,
        config: any,
        redis: RedisClient,
        donations: any,
        version: string,
    ) {

        this.app = app;
        this.config = config;
        this.port = config.api.port;
        this.logger = new Logger(config.logging);
        this.pr = new PoolRequest(this.config.daemon, this.config.wallet, this.config.api);
        this.api = new API(config, this.logger, this.pr);
        this.redis = redis;
        this.charts = new Charts(config.charts, this.pr, this.logger);
        this.donations = donations;
        this.version = version;
    }

    public getApi() {
        return this.api;
    }

    async start() {
        this.init();
        setTimeout(async () => {
            await this.api.collectStatus(this.charts, this.redis, this.donations, this.version);
        }, 0);
        this.server = this.app.listen(this.port, () => {
            this.logger.append('info', 'api',
                'API started & listening on port ' + String(this.port), []);
        });
        return this.server;
    }

    init() {
        this.app.use(cors());
        this.app.use(cookiesParser());
        this.userRouting(this.app);
        this.adminRouting(this.app);
    }

    userRouting(app: Application) {
        const router = Router();

        router.all('/stats', (req, res) => {
            this.onStatus(req, res);
        });
        router.all('/live_stats', (req, res) => {
            this.onLiveStatus(req, res);
        });
        router.all('/stats_address', async (req, res) => {
            await this.onAddressStats(req, res);
        });
        router.all('/get_payments', async (req, res) => {
            await this.onGetPayments(req, res);
        });
        router.all('/get_blocks', async (req, res) => {
            await this.onGetBlocks(req, res);
        });
        app.use(router);

    }
    adminRouting(app: Application) {
        const router = Router();

        const isAdmin = (req: Request, res: Response, next: Function) => {
            if (req.query.password === this.config.api.password) {
                next();
                return;
            }
            res.status(401).send("Invalid password!");
        }

        router.all('/admin_stats', isAdmin, async (req, res) => {
            await this.onAdminStatus(req, res);
        });
        router.all('/admin_monitoring', isAdmin, async (req, res) => {
            await this.onAdminMonitor(req, res);
        });
        router.all('/admin_log', isAdmin, async (req, res) => {
            this.onAdminLog(req, res);
        });
        router.all('/admin_users', isAdmin, async (req, res) => {
            await this.onAdminUsers(req, res);
        });
        router.all('/miners_hashrate', isAdmin, (req, res) => {
            this.onAdminHashrate(req, res);
        });
        app.use(router);
    }
    async onAdminHashrate(req: Request, res: Response) {
        const hashrates = this.api.getHashrates();
        res.json(hashrates);

    }
    async onAdminUsers(req: Request, res: Response) {
        let keys = promisify(this.redis.keys).bind(this.redis);
        let workers = await keys([this.config.coin, 'workers', '*'].join(':'));
        let redisData = workers.map((key: string) => {
            let hmget = promisify(this.redis.hmget).bind(this.redis);
            return hmget(key, 'balance', 'paid', 'lastShare', 'hashes');
        });
        var workersData: any = {};
        var addressLength = _.get(this.config, 'poolServer.poolAddress');
        for (var i in redisData) {
            var address = workers[i].substr(-addressLength);
            var data = redisData[i];
            workersData[address] = {
                pending: data[0],
                paid: data[1],
                lastShare: data[2],
                hashes: data[3],
                hashrate: this.api.getHashrate(address)
            };
        }
        res.json(workersData);
    }


    onAdminLog(req: Request, res: Response) {
        var file = req.query.file;
        if (!file.match(/^\w+\.log$/)) {
            res.status(403).end('wrong log file');
            return;
        }
        var filePath = this.logger.getDir() + '/' + file;

        res.writeHead(200, {
            'Content-Length': fs.statSync(filePath).size
        });
        fs.createReadStream(filePath).pipe(res);
    }

    async onAdminMonitor(req: Request, res: Response) {
        const coin = this.config.coin;
        const modules = Object.keys(this.config.monitoring);
        let results = []
        let hgetall = promisify(this.redis.hgetall).bind(this.redis);

        for (const key of modules) {
            results.push(await hgetall([coin, 'status', key].join(':')));
        }
        const stats: any = {};
        results.forEach((e: any, i: number) => {
            stats[modules[i]] = e;
        });
        res.json({
            monitoring: stats,
            logs: await this.logger.getStatus()
        });
    }

    async onAdminStatus(req: Request, res: Response) {
        const coin = this.config.coin;

        let keys = promisify(this.redis.keys).bind(this.redis);
        const workers = await keys(coin + ':workers:*');
        let zrange = promisify(this.redis.zrange).bind(this.redis);

        const blocks = await zrange(coin + ':blocks:matured', 0, -1);

        let multi = promisify(this.redis.multi).bind(this.redis);

        const workerPaid = workers.map(async (key: string) => {
            let hmget = promisify(this.redis.hmget).bind(this.redis);
            return hmget(key, 'balance', 'paid');
        })
        let stats = {
            totalOwed: 0,
            totalPaid: 0,
            totalRevenue: 0,
            totalDiff: 0,
            totalShares: 0,
            blocksOrphaned: 0,
            blocksUnlocked: 0,
            totalWorkers: 0
        };

        for (var i = 0; i < workerPaid.length; i++) {
            stats.totalOwed += parseInt(workerPaid[i][0]) || 0;
            stats.totalPaid += parseInt(workerPaid[i][1]) || 0;
            stats.totalWorkers++;
        }

        for (var i = 0; i < blocks.length; i++) {
            var block = blocks[i].split(':');
            if (block[5]) {
                stats.blocksUnlocked++;
                stats.totalDiff += parseInt(block[2]);
                stats.totalShares += parseInt(block[3]);
                stats.totalRevenue += parseInt(block[5]);
            }
            else {
                stats.blocksOrphaned++;
            }
        }
        res.json(stats);
    }

    async onGetBlocks(req: Request, res: Response) {
        const coin = this.config.coin;
        const blocks = this.config.api.blocks;
        let keys = [this.config.coin, 'blocks', 'matured'];
        let height = parseFloat(req.query.height);
        try {
            let score = promisify(this.redis.zrevrangebyscore).bind(this.redis);
            let json = await score(keys.join(':'),
                '(' + height,
                '-inf',
                'WITHSCORES',
                'LIMIT',
                0,
                blocks
            );
            res.json(json);
        } catch (e) {
            res.json({
                error: 'query failed'
            });
        }
    }

    async onGetPayments(req: Request, res: Response) {

        const coin = this.config.coin;
        const payments = this.config.api.payments;
        let keys = [this.config.coin, 'payments'];
        if (req.query.address) {
            keys.push(req.query.address);
        } else {
            keys.push('all');
        }
        try {
            let score = promisify(this.redis.zrevrangebyscore).bind(this.redis);
            let json = await score(keys.join(':'),
                '(' + req.query.time,
                '-inf',
                'WITHSCORES',
                'LIMIT',
                0,
                payments
            );
            res.json(json);
        } catch (e) {
            console.error(e);
            res.json({
                error: 'query failed'
            });
        }
    }

    async onAddressStats(req: Request, res: Response) {
        const { address, longpoll } = req.query;
        if (!address) {
            res.status(403).end();
            return;
        }

        res.set('Connection', 'keep-alive');
        let status = await this.api.getAddressStatus(this.redis, this.config.coin, address);
        let payments = await this.api.getAddressPayments(this.redis, this.config.coin, address);
        let charts = await this.charts.getUserCharts(this.redis, this.config.coin, address);
        res.json({
            stats: status,
            payments,
            charts
        });
    }

    onStatus(req: Request, res: Response) {
        let deflate = false;
        const accept = req.headers['accept-encoding'];
        if (accept) {
            deflate = accept.indexOf('deflate') != -1;
        }
        if (deflate) {
            res.setHeader('Content-Encoding', 'deflate');
        }
        let text = this.api.getCurrentStatus(!!deflate);
        res.end(text);
    }

    onLiveStatus(req: Request, res: Response) {
        res.writeHead(200, {
            'Connection': 'keep-alive'
        });
        this.api.addConnection(res);
    }
}