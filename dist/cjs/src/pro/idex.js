'use strict';

var idex$1 = require('../idex.js');
var errors = require('../base/errors.js');
var Cache = require('../base/ws/Cache.js');
var Precise = require('../base/Precise.js');

//  ---------------------------------------------------------------------------
//  ---------------------------------------------------------------------------
class idex extends idex$1 {
    describe() {
        return this.deepExtend(super.describe(), {
            'has': {
                'ws': true,
                'watchOrderBook': true,
                'watchTrades': true,
                'watchOHLCV': true,
                'watchTicker': true,
                'watchTickers': false,
                'watchOrders': true,
                'watchTransactions': true,
            },
            'urls': {
                'test': {
                    'ws': 'wss://websocket-matic.idex.io/v1',
                },
                'api': {},
            },
            'options': {
                'tradesLimit': 1000,
                'ordersLimit': 1000,
                'OHLCVLimit': 1000,
                'watchOrderBookLimit': 1000,
                'orderBookSubscriptions': {},
                'token': undefined,
                'watchOrderBook': {
                    'snapshotMaxRetries': 3,
                },
                'fetchOrderBookSnapshotMaxAttempts': 10,
                'fetchOrderBookSnapshotMaxDelay': 10000, // throw if there are no orders in 10 seconds
            },
        });
    }
    async subscribe(subscribeObject, messageHash, subscription = true) {
        const url = this.urls['test']['ws'];
        const request = {
            'method': 'subscribe',
            'subscriptions': [
                subscribeObject,
            ],
        };
        return await this.watch(url, messageHash, request, messageHash, subscription);
    }
    async subscribePrivate(subscribeObject, messageHash) {
        const token = await this.authenticate();
        const url = this.urls['test']['ws'];
        const request = {
            'method': 'subscribe',
            'token': token,
            'subscriptions': [
                subscribeObject,
            ],
        };
        return await this.watch(url, messageHash, request, messageHash);
    }
    async watchTicker(symbol, params = {}) {
        /**
         * @method
         * @name idex#watchTicker
         * @description watches a price ticker, a statistical calculation with the information calculated over the past 24 hours for a specific market
         * @param {string} symbol unified symbol of the market to fetch the ticker for
         * @param {object} [params] extra parameters specific to the idex api endpoint
         * @returns {object} a [ticker structure]{@link https://docs.ccxt.com/#/?id=ticker-structure}
         */
        await this.loadMarkets();
        const market = this.market(symbol);
        const name = 'tickers';
        const subscribeObject = {
            'name': name,
            'markets': [market['id']],
        };
        const messageHash = name + ':' + market['id'];
        return await this.subscribe(this.extend(subscribeObject, params), messageHash);
    }
    handleTicker(client, message) {
        // { type: 'tickers',
        //   data:
        //    { m: 'DIL-ETH',
        //      t: 1599213946045,
        //      o: '0.09699020',
        //      h: '0.10301548',
        //      l: '0.09577222',
        //      c: '0.09907311',
        //      Q: '1.32723120',
        //      v: '297.80667468',
        //      q: '29.52142669',
        //      P: '2.14',
        //      n: 197,
        //      a: '0.09912245',
        //      b: '0.09686980',
        //      u: 5870 } }
        const type = this.safeString(message, 'type');
        const data = this.safeValue(message, 'data');
        const marketId = this.safeString(data, 'm');
        const symbol = this.safeSymbol(marketId);
        const messageHash = type + ':' + marketId;
        const timestamp = this.safeInteger(data, 't');
        const close = this.safeString(data, 'c');
        const percentage = this.safeString(data, 'P');
        let change = undefined;
        if ((percentage !== undefined) && (close !== undefined)) {
            change = Precise["default"].stringMul(close, percentage);
        }
        const ticker = this.safeTicker({
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'high': this.safeString(data, 'h'),
            'low': this.safeString(data, 'l'),
            'bid': this.safeString(data, 'b'),
            'bidVolume': undefined,
            'ask': this.safeString(data, 'a'),
            'askVolume': undefined,
            'vwap': undefined,
            'open': this.safeString(data, 'o'),
            'close': close,
            'last': close,
            'previousClose': undefined,
            'change': change,
            'percentage': percentage,
            'average': undefined,
            'baseVolume': this.safeString(data, 'v'),
            'quoteVolume': this.safeString(data, 'q'),
            'info': message,
        });
        client.resolve(ticker, messageHash);
    }
    async watchTrades(symbol, since = undefined, limit = undefined, params = {}) {
        /**
         * @method
         * @name idex#watchTrades
         * @description get the list of most recent trades for a particular symbol
         * @param {string} symbol unified symbol of the market to fetch trades for
         * @param {int} [since] timestamp in ms of the earliest trade to fetch
         * @param {int} [limit] the maximum amount of trades to fetch
         * @param {object} [params] extra parameters specific to the idex api endpoint
         * @returns {object[]} a list of [trade structures]{@link https://docs.ccxt.com/en/latest/manual.html?#public-trades}
         */
        await this.loadMarkets();
        const market = this.market(symbol);
        symbol = market['symbol'];
        const name = 'trades';
        const subscribeObject = {
            'name': name,
            'markets': [market['id']],
        };
        const messageHash = name + ':' + market['id'];
        const trades = await this.subscribe(subscribeObject, messageHash);
        if (this.newUpdates) {
            limit = trades.getLimit(symbol, limit);
        }
        return this.filterBySinceLimit(trades, since, limit, 'timestamp', true);
    }
    handleTrade(client, message) {
        const type = this.safeString(message, 'type');
        const data = this.safeValue(message, 'data');
        const marketId = this.safeString(data, 'm');
        const messageHash = type + ':' + marketId;
        const trade = this.parseWsTrade(data);
        const keys = Object.keys(this.trades);
        const length = keys.length;
        if (length === 0) {
            const limit = this.safeInteger(this.options, 'tradesLimit');
            this.trades = new Cache.ArrayCacheBySymbolById(limit);
        }
        const trades = this.trades;
        trades.append(trade);
        client.resolve(trades, messageHash);
    }
    parseWsTrade(trade, market = undefined) {
        // public trades
        // { m: 'DIL-ETH',
        //   i: '897ecae6-4b75-368a-ac00-be555e6ad65f',
        //   p: '0.09696995',
        //   q: '2.00000000',
        //   Q: '0.19393990',
        //   t: 1599504616247,
        //   s: 'buy',
        //   u: 6620 }
        // private trades
        // { i: 'ee253d78-88be-37ed-a61c-a36395c2ce48',
        //   p: '0.09925382',
        //   q: '0.15000000',
        //   Q: '0.01488807',
        //   t: 1599499129369,
        //   s: 'sell',
        //   u: 6603,
        //   f: '0.00030000',
        //   a: 'DIL',
        //   g: '0.00856110',
        //   l: 'maker',
        //   S: 'pending' }
        const marketId = this.safeString(trade, 'm');
        const symbol = this.safeSymbol(marketId);
        const id = this.safeString(trade, 'i');
        const price = this.safeFloat(trade, 'p');
        const amount = this.safeFloat(trade, 'q');
        const cost = this.safeFloat(trade, 'Q');
        const timestamp = this.safeInteger(trade, 't');
        const side = this.safeString(trade, 's');
        const fee = {
            'currency': this.safeString(trade, 'a'),
            'cost': this.safeFloat(trade, 'f'),
        };
        const takerOrMarker = this.safeString(trade, 'l');
        return {
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'symbol': symbol,
            'id': id,
            'order': undefined,
            'type': undefined,
            'takerOrMaker': takerOrMarker,
            'side': side,
            'price': price,
            'amount': amount,
            'cost': cost,
            'fee': fee,
        };
    }
    async watchOHLCV(symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        /**
         * @method
         * @name idex#watchOHLCV
         * @description watches historical candlestick data containing the open, high, low, and close price, and the volume of a market
         * @param {string} symbol unified symbol of the market to fetch OHLCV data for
         * @param {string} timeframe the length of time each candle represents
         * @param {int} [since] timestamp in ms of the earliest candle to fetch
         * @param {int} [limit] the maximum amount of candles to fetch
         * @param {object} [params] extra parameters specific to the idex api endpoint
         * @returns {int[][]} A list of candles ordered as timestamp, open, high, low, close, volume
         */
        await this.loadMarkets();
        const market = this.market(symbol);
        symbol = market['symbol'];
        const name = 'candles';
        const interval = this.safeString(this.timeframes, timeframe, timeframe);
        const subscribeObject = {
            'name': name,
            'markets': [market['id']],
            'interval': interval,
        };
        const messageHash = name + ':' + market['id'];
        const ohlcv = await this.subscribe(subscribeObject, messageHash);
        if (this.newUpdates) {
            limit = ohlcv.getLimit(symbol, limit);
        }
        return this.filterBySinceLimit(ohlcv, since, limit, 0, true);
    }
    handleOHLCV(client, message) {
        // { type: 'candles',
        //   data:
        //    { m: 'DIL-ETH',
        //      t: 1599477340109,
        //      i: '1m',
        //      s: 1599477300000,
        //      e: 1599477360000,
        //      o: '0.09911040',
        //      h: '0.09911040',
        //      l: '0.09911040',
        //      c: '0.09911040',
        //      v: '0.15000000',
        //      n: 1,
        //      u: 6531 } }
        const type = this.safeString(message, 'type');
        const data = this.safeValue(message, 'data');
        const marketId = this.safeString(data, 'm');
        const messageHash = type + ':' + marketId;
        const parsed = [
            this.safeInteger(data, 's'),
            this.safeFloat(data, 'o'),
            this.safeFloat(data, 'h'),
            this.safeFloat(data, 'l'),
            this.safeFloat(data, 'c'),
            this.safeFloat(data, 'v'),
        ];
        const symbol = this.safeSymbol(marketId);
        const interval = this.safeString(data, 'i');
        const timeframe = this.findTimeframe(interval);
        // TODO: move to base class
        this.ohlcvs[symbol] = this.safeValue(this.ohlcvs, symbol, {});
        let stored = this.safeValue(this.ohlcvs[symbol], timeframe);
        if (stored === undefined) {
            const limit = this.safeInteger(this.options, 'OHLCVLimit', 1000);
            stored = new Cache.ArrayCacheByTimestamp(limit);
            this.ohlcvs[symbol][timeframe] = stored;
        }
        stored.append(parsed);
        client.resolve(stored, messageHash);
    }
    handleSubscribeMessage(client, message) {
        // {
        //   "type": "subscriptions",
        //   "subscriptions": [
        //     {
        //       "name": "l2orderbook",
        //       "markets": [
        //         "DIL-ETH"
        //       ]
        //     }
        //   ]
        // }
        const subscriptions = this.safeValue(message, 'subscriptions');
        for (let i = 0; i < subscriptions.length; i++) {
            const subscription = subscriptions[i];
            const name = this.safeString(subscription, 'name');
            if (name === 'l2orderbook') {
                const markets = this.safeValue(subscription, 'markets');
                for (let j = 0; j < markets.length; j++) {
                    const marketId = markets[j];
                    const orderBookSubscriptions = this.safeValue(this.options, 'orderBookSubscriptions', {});
                    if (!(marketId in orderBookSubscriptions)) {
                        const symbol = this.safeSymbol(marketId);
                        if (!(symbol in this.orderbooks)) {
                            const orderbook = this.countedOrderBook({});
                            orderbook.cache = [];
                            this.orderbooks[symbol] = orderbook;
                        }
                        this.spawn(this.fetchOrderBookSnapshot, client, symbol);
                    }
                }
                break;
            }
        }
    }
    async fetchOrderBookSnapshot(client, symbol, params = {}) {
        const orderbook = this.orderbooks[symbol];
        const market = this.market(symbol);
        const messageHash = 'l2orderbook' + ':' + market['id'];
        const subscription = client.subscriptions[messageHash];
        if (!subscription['fetchingOrderBookSnapshot']) {
            subscription['startTime'] = this.milliseconds();
        }
        subscription['fetchingOrderBookSnapshot'] = true;
        const maxAttempts = this.safeInteger(this.options, 'fetchOrderBookSnapshotMaxAttempts', 10);
        const maxDelay = this.safeInteger(this.options, 'fetchOrderBookSnapshotMaxDelay', 10000);
        try {
            const limit = this.safeInteger(subscription, 'limit', 0);
            // 3. Request a level-2 order book snapshot for the market from the REST API Order Books endpoint with limit set to 0.
            const snapshot = await this.fetchRestOrderBookSafe(symbol, limit);
            const firstBuffered = this.safeValue(orderbook.cache, 0);
            const firstData = this.safeValue(firstBuffered, 'data');
            const firstNonce = this.safeInteger(firstData, 'u');
            const length = orderbook.cache.length;
            const lastBuffered = this.safeValue(orderbook.cache, length - 1);
            const lastData = this.safeValue(lastBuffered, 'data');
            const lastNonce = this.safeInteger(lastData, 'u');
            const bothExist = (firstNonce !== undefined) && (lastNonce !== undefined);
            // ensure the snapshot is inside the range of our cached messages
            // for example if the snapshot nonce is 100
            // the first nonce must be less than or equal to 101 and the last nonce must be greater than 101
            if (bothExist && (firstNonce <= snapshot['nonce'] + 1) && (lastNonce > snapshot['nonce'])) {
                orderbook.reset(snapshot);
                for (let i = 0; i < orderbook.cache.length; i++) {
                    const message = orderbook.cache[i];
                    const data = this.safeValue(message, 'data');
                    const u = this.safeInteger(data, 'u');
                    if (u > orderbook['nonce']) {
                        // 5. Discard all order book update messages with sequence numbers less than or equal to the snapshot sequence number.
                        // 6. Apply the remaining buffered order book update messages and any incoming order book update messages to the order book snapshot.
                        this.handleOrderBookMessage(client, message, orderbook);
                    }
                }
                subscription['fetchingOrderBookSnapshot'] = false;
                client.resolve(orderbook, messageHash);
            }
            else {
                // 4. If the sequence in the order book snapshot is less than the sequence of the
                //    first buffered order book update message, discard the order book snapshot and retry step 3.
                // this will continue to recurse until we have a buffered message
                // since updates the order book endpoint depend on order events
                // so it will eventually throw if there are no orders on a pair
                subscription['numAttempts'] = subscription['numAttempts'] + 1;
                const timeElapsed = this.milliseconds() - subscription['startTime'];
                const maxAttemptsValid = subscription['numAttempts'] < maxAttempts;
                const timeElapsedValid = timeElapsed < maxDelay;
                if (maxAttemptsValid && timeElapsedValid) {
                    this.delay(this.rateLimit, this.fetchOrderBookSnapshot, client, symbol);
                }
                else {
                    const endpart = (!maxAttemptsValid) ? ' in ' + maxAttempts.toString() + ' attempts' : ' after ' + maxDelay.toString() + ' milliseconds';
                    throw new errors.InvalidNonce(this.id + ' failed to synchronize WebSocket feed with the snapshot for symbol ' + symbol + endpart);
                }
            }
        }
        catch (e) {
            subscription['fetchingOrderBookSnapshot'] = false;
            client.reject(e, messageHash);
        }
    }
    async watchOrderBook(symbol, limit = undefined, params = {}) {
        /**
         * @method
         * @name idex#watchOrderBook
         * @description watches information on open orders with bid (buy) and ask (sell) prices, volumes and other data
         * @param {string} symbol unified symbol of the market to fetch the order book for
         * @param {int} [limit] the maximum amount of order book entries to return
         * @param {object} [params] extra parameters specific to the idex api endpoint
         * @returns {object} A dictionary of [order book structures]{@link https://docs.ccxt.com/#/?id=order-book-structure} indexed by market symbols
         */
        await this.loadMarkets();
        const market = this.market(symbol);
        const name = 'l2orderbook';
        const subscribeObject = {
            'name': name,
            'markets': [market['id']],
        };
        const messageHash = name + ':' + market['id'];
        const subscription = {
            'fetchingOrderBookSnapshot': false,
            'numAttempts': 0,
            'startTime': undefined,
        };
        if (limit === undefined) {
            subscription['limit'] = 1000;
        }
        else {
            subscription['limit'] = limit;
        }
        // 1. Connect to the WebSocket API endpoint and subscribe to the L2 Order Book for the target market.
        const orderbook = await this.subscribe(subscribeObject, messageHash, subscription);
        return orderbook.limit();
    }
    handleOrderBook(client, message) {
        const data = this.safeValue(message, 'data');
        const marketId = this.safeString(data, 'm');
        const symbol = this.safeSymbol(marketId);
        const orderbook = this.orderbooks[symbol];
        if (orderbook['nonce'] === undefined) {
            // 2. Buffer the incoming order book update subscription messages.
            orderbook.cache.push(message);
        }
        else {
            this.handleOrderBookMessage(client, message, orderbook);
        }
    }
    handleOrderBookMessage(client, message, orderbook) {
        // {
        //   "type": "l2orderbook",
        //   "data": {
        //     "m": "DIL-ETH",
        //     "t": 1600197205037,
        //     "u": 94116643,
        //     "b": [
        //       [
        //         "0.09662187",
        //         "0.00000000",
        //         0
        //       ]
        //     ],
        //     "a": []
        //   }
        // }
        const type = this.safeString(message, 'type');
        const data = this.safeValue(message, 'data');
        const marketId = this.safeString(data, 'm');
        const messageHash = type + ':' + marketId;
        const nonce = this.safeInteger(data, 'u');
        const timestamp = this.safeInteger(data, 't');
        const bids = this.safeValue(data, 'b');
        const asks = this.safeValue(data, 'a');
        this.handleDeltas(orderbook['bids'], bids);
        this.handleDeltas(orderbook['asks'], asks);
        orderbook['nonce'] = nonce;
        orderbook['timestamp'] = timestamp;
        orderbook['datetime'] = this.iso8601(timestamp);
        client.resolve(orderbook, messageHash);
    }
    handleDelta(bookside, delta) {
        const price = this.safeFloat(delta, 0);
        const amount = this.safeFloat(delta, 1);
        const count = this.safeInteger(delta, 2);
        bookside.store(price, amount, count);
    }
    handleDeltas(bookside, deltas) {
        for (let i = 0; i < deltas.length; i++) {
            this.handleDelta(bookside, deltas[i]);
        }
    }
    async authenticate(params = {}) {
        const time = this.seconds();
        const lastAuthenticatedTime = this.safeInteger(this.options, 'lastAuthenticatedTime', 0);
        if (time - lastAuthenticatedTime > 900) {
            const request = {
                'wallet': this.walletAddress,
                'nonce': this.uuidv1(),
            };
            const response = await this.privateGetWsToken(this.extend(request, params));
            this.options['lastAuthenticatedTime'] = time;
            this.options['token'] = this.safeString(response, 'token');
        }
        return this.options['token'];
    }
    async watchOrders(symbol = undefined, since = undefined, limit = undefined, params = {}) {
        /**
         * @method
         * @name idex#watchOrders
         * @description watches information on multiple orders made by the user
         * @param {string} symbol unified market symbol of the market orders were made in
         * @param {int} [since] the earliest time in ms to fetch orders for
         * @param {int} [limit] the maximum number of  orde structures to retrieve
         * @param {object} [params] extra parameters specific to the idex api endpoint
         * @returns {object[]} a list of [order structures]{@link https://docs.ccxt.com/#/?id=order-structure}
         */
        await this.loadMarkets();
        const name = 'orders';
        const subscribeObject = {
            'name': name,
        };
        let messageHash = name;
        if (symbol !== undefined) {
            symbol = this.symbol(symbol);
            const marketId = this.marketId(symbol);
            subscribeObject['markets'] = [marketId];
            messageHash = name + ':' + marketId;
        }
        const orders = await this.subscribePrivate(subscribeObject, messageHash);
        if (this.newUpdates) {
            limit = orders.getLimit(symbol, limit);
        }
        return this.filterBySinceLimit(orders, since, limit, 'timestamp', true);
    }
    handleOrder(client, message) {
        // {
        //   "type": "orders",
        //   "data": {
        //     "m": "DIL-ETH",
        //     "i": "8f75dd30-f12d-11ea-b63c-df3381b4b5b4",
        //     "w": "0x0AB991497116f7F5532a4c2f4f7B1784488628e1",
        //     "t": 1599498857138,
        //     "T": 1599498857092,
        //     "x": "fill",
        //     "X": "filled",
        //     "u": 67695627,
        //     "o": "limit",
        //     "S": "buy",
        //     "q": "0.15000000",
        //     "z": "0.15000000",
        //     "Z": "0.01486286",
        //     "v": "0.09908573",
        //     "p": "1.00000000",
        //     "f": "gtc",
        //     "V": "2",
        //     "F": [
        //       {
        //         "i": "5cdc6d14-bc35-3279-ab5e-40d654ca1523",
        //         "p": "0.09908577",
        //         "q": "0.15000000",
        //         "Q": "0.01486286",
        //         "t": 1599498857092,
        //         "s": "sell",
        //         "u": 6600,
        //         "f": "0.00030000",
        //         "a": "DIL",
        //         "g": "0.00856977",
        //         "l": "maker",
        //         "S": "pending"
        //       }
        //     ]
        //   }
        // }
        const type = this.safeString(message, 'type');
        const order = this.safeValue(message, 'data');
        const marketId = this.safeString(order, 'm');
        const symbol = this.safeSymbol(marketId);
        const timestamp = this.safeInteger(order, 't');
        const fills = this.safeValue(order, 'F');
        const trades = [];
        for (let i = 0; i < fills.length; i++) {
            trades.push(this.parseWsTrade(fills[i]));
        }
        const id = this.safeString(order, 'i');
        const side = this.safeString(order, 's');
        const orderType = this.safeString(order, 'o');
        const amount = this.safeFloat(order, 'q');
        const filled = this.safeFloat(order, 'z');
        let remaining = undefined;
        if ((amount !== undefined) && (filled !== undefined)) {
            remaining = amount - filled;
        }
        const average = this.safeFloat(order, 'v');
        const price = this.safeFloat(order, 'price', average); // for market orders
        let cost = undefined;
        if ((amount !== undefined) && (price !== undefined)) {
            cost = amount * price;
        }
        const rawStatus = this.safeString(order, 'X');
        const status = this.parseOrderStatus(rawStatus);
        const fee = {
            'currency': undefined,
            'cost': undefined,
        };
        let lastTrade = undefined;
        for (let i = 0; i < trades.length; i++) {
            lastTrade = trades[i];
            fee['currency'] = lastTrade['fee']['currency'];
            fee['cost'] = this.sum(fee['cost'], lastTrade['fee']['cost']);
        }
        const lastTradeTimestamp = this.safeInteger(lastTrade, 'timestamp');
        const parsedOrder = {
            'info': message,
            'id': id,
            'clientOrderId': undefined,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'lastTradeTimestamp': lastTradeTimestamp,
            'symbol': symbol,
            'type': orderType,
            'side': side,
            'price': price,
            'stopPrice': undefined,
            'triggerPrice': undefined,
            'amount': amount,
            'cost': cost,
            'average': average,
            'filled': filled,
            'remaining': remaining,
            'status': status,
            'fee': fee,
            'trades': trades,
        };
        if (this.orders === undefined) {
            const limit = this.safeInteger(this.options, 'ordersLimit', 1000);
            this.orders = new Cache.ArrayCacheBySymbolById(limit);
        }
        const orders = this.orders;
        orders.append(parsedOrder);
        const symbolSpecificMessageHash = type + ':' + marketId;
        client.resolve(orders, symbolSpecificMessageHash);
        client.resolve(orders, type);
    }
    async watchTransactions(code = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets();
        const name = 'balances';
        const subscribeObject = {
            'name': name,
        };
        let messageHash = name;
        if (code !== undefined) {
            messageHash = name + ':' + code;
        }
        const transactions = await this.subscribePrivate(subscribeObject, messageHash);
        if (this.newUpdates) {
            limit = transactions.getLimit(code, limit);
        }
        return this.filterBySinceLimit(transactions, since, limit, 'timestamp');
    }
    handleTransaction(client, message) {
        // Update Speed: Real time, updates on any deposit or withdrawal of the wallet
        // { type: 'balances',
        //   data:
        //    { w: '0x0AB991497116f7F5532a4c2f4f7B1784488628e1',
        //      a: 'ETH',
        //      q: '0.11198667',
        //      f: '0.11198667',
        //      l: '0.00000000',
        //      d: '0.00' } }
        const type = this.safeString(message, 'type');
        const data = this.safeValue(message, 'data');
        const currencyId = this.safeString(data, 'a');
        const messageHash = type + ':' + currencyId;
        const code = this.safeCurrencyCode(currencyId);
        const address = this.safeString(data, 'w');
        const transaction = {
            'info': message,
            'id': undefined,
            'currency': code,
            'amount': undefined,
            'address': address,
            'addressTo': undefined,
            'addressFrom': undefined,
            'tag': undefined,
            'tagTo': undefined,
            'tagFrom': undefined,
            'status': 'ok',
            'type': undefined,
            'updated': undefined,
            'txid': undefined,
            'timestamp': undefined,
            'datetime': undefined,
            'fee': undefined,
        };
        if (!(code in this.transactions)) {
            const limit = this.safeInteger(this.options, 'transactionsLimit', 1000);
            this.transactions[code] = new Cache.ArrayCache(limit);
        }
        const transactions = this.transactions[code];
        transactions.append(transaction);
        client.resolve(transactions, messageHash);
        client.resolve(transactions, type);
    }
    handleMessage(client, message) {
        const type = this.safeString(message, 'type');
        const methods = {
            'tickers': this.handleTicker,
            'trades': this.handleTrade,
            'subscriptions': this.handleSubscribeMessage,
            'candles': this.handleOHLCV,
            'l2orderbook': this.handleOrderBook,
            'balances': this.handleTransaction,
            'orders': this.handleOrder,
        };
        if (type in methods) {
            const method = methods[type];
            method.call(this, client, message);
        }
    }
}

module.exports = idex;
