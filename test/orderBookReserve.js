const TestToken = artifacts.require("./mockContracts/TestToken.sol");
const KyberNetwork = artifacts.require("./KyberNetwork.sol");
const FeeBurner = artifacts.require("./FeeBurner.sol");
const Orders = artifacts.require("./permissionless/Orders.sol");
const OrdersFactory = artifacts.require("./permissionless/OrdersFactory.sol");
const OrderBookReserve = artifacts.require("./permissionless/mock/MockOrderBookReserve.sol");
const FeeBurnerResolver = artifacts.require("./permissionless/mock/MockFeeBurnerResolver.sol");

const Helper = require("./helper.js");
const BigNumber = require('bignumber.js');

//global variables
//////////////////
const precisionUnits = (new BigNumber(10).pow(18));
const ethAddress = '0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

//permission groups
let admin;
let withDrawAddress;

//contracts
let reserve;
let feeBurner;
let feeBurnerResolver;
let network;
let ordersFactory;

//tokens data
////////////
let token;
let tokenAdd;
let KNCToken;
let kncAddress;

let headId;
let tailId;

//addresses
let user1;
let user2;
let maker1;
let maker2;

let currentBlock;

contract('OrderBookReserve', async (accounts) => {

    before('one time init. tokens, accounts', async() => {
        admin = accounts[0];
        user1 = accounts[1];
        user2 = accounts[2];
        maker1 = accounts[3];
        maker2 = accounts[4];
        network = accounts[5];
        
        token = await TestToken.new("the token", "TOK", 18);
        tokenAdd = token.address;

        KNCToken = await TestToken.new("Kyber Crystals", "KNC", 18);
        kncAddress = KNCToken.address;
//        network = await KyberNetwork.new(admin);
        
        feeBurner = await FeeBurner.new(admin, kncAddress, network);

        feeBurnerResolver = await FeeBurnerResolver.new(feeBurner.address);

        ordersFactory = await OrdersFactory.new();

        currentBlock = await Helper.getCurrentBlock();
    });

    beforeEach('setup contract for each test', async () => {

//        log(feeBurner.address + " " + kncAddress + " " + tokenAdd)
        reserve = await OrderBookReserve.new(kncAddress, tokenAdd, feeBurnerResolver.address, ordersFactory.address, 25);
//        log(reserve);
        await reserve.init();
    });

    afterEach('withdraw ETH from contracts', async () => {
        let rxWei = await reserve.makerFunds(maker1, ethAddress);
        if (rxWei.valueOf() > 0) {
            await reserve.withdrawEther(rxWei.valueOf(), {from: maker1})
        }

        rxWei = await reserve.makerFunds(maker2, ethAddress);
        if (rxWei.valueOf() > 0) {
            await reserve.withdrawEther(rxWei.valueOf(), {from: maker2})
        }
    });

    it("test globals.", async () => {
        let ordersAdd = await reserve.sellList();
        let orders = Orders.at(ordersAdd.valueOf());

        headId = (await orders.HEAD_ID()).valueOf();
        tailId = (await orders.TAIL_ID()).valueOf();

        let rxToken = await reserve.token();
        assert.equal(rxToken.valueOf(), tokenAdd);

        let rxKnc = await reserve.kncToken();
        assert.equal(rxKnc.valueOf(), kncAddress);
    });

    it("maker deposit tokens, ethers, knc, validate updated in contract", async () => {
        let amountTwei = 5 * 10 ** 19; //500 tokens
        let amountKnc = 600 * 10 ** 18;
        let amountEth = 2 * 10 ** 18;

        await makerDeposit(maker1, amountEth, amountTwei.valueOf(), amountKnc.valueOf());

        let rxNumTwei = await reserve.makerFunds(maker1, tokenAdd);
        assert.equal(rxNumTwei.valueOf(), amountTwei);

        let rxKncTwei = await reserve.makerUnusedKNC(maker1);
        assert.equal(rxKncTwei.valueOf(), amountKnc);

        rxKncTwei = await reserve.makerStakedKNC(maker1);
        assert.equal(rxKncTwei.valueOf(), 0);

        //makerDepositEther
        let rxWei = await reserve.makerFunds(maker1, ethAddress);
        assert.equal(rxWei.valueOf(), amountEth);

        await reserve.withdrawEther( rxWei, {from: maker1})
        rxWei = await reserve.makerFunds(maker1, ethAddress);
        assert.equal(rxWei.valueOf(), 0);
    });

    it("maker deposit knc, test bind knc.", async () => {
        let initKnc = (new BigNumber(2)).mul(10 ** 18);

        await makerDeposit(maker1, 0, 0, initKnc.valueOf());

        let stakedKnc = await reserve.makerStakedKNC(maker1);
        assert.equal(stakedKnc.valueOf(), 0);

        let freeKnc = await reserve.makerUnusedKNC(maker1);
        assert.equal(freeKnc.valueOf(), initKnc.valueOf());

        let stakeKncVal = 10 ** 17;
        await reserve.testBindStakes(maker1, stakeKncVal); //0.1 tokens

        stakedKnc = await reserve.makerStakedKNC(maker1);
        assert.equal(stakedKnc.valueOf(), stakeKncVal);

        freeKnc = await reserve.makerUnusedKNC(maker1);
        assert.equal(freeKnc.valueOf(), initKnc.sub(stakeKncVal).valueOf());

        let stakeKnc2nd = 10 ** 16;
        await reserve.testBindStakes(maker1, stakeKnc2nd); //0.1 tokens
        let expectedStakes = (new BigNumber(stakeKncVal)).add(stakeKnc2nd);

        stakedKnc = await reserve.makerStakedKNC(maker1);
        assert.equal(stakedKnc.valueOf(), expectedStakes.valueOf());

        freeKnc = await reserve.makerUnusedKNC(maker1);
        assert.equal(freeKnc.valueOf(), initKnc.sub(expectedStakes).valueOf());
    });

    it("maker deposit knc, bind knc. test release knc stakes", async () => {
        let initKnc = (new BigNumber(2)).mul(10 ** 18);

        await makerDeposit(maker1, 0, 0, initKnc.valueOf());
        let stakeKncVal = new BigNumber(10 ** 18);
        await reserve.testBindStakes(maker1, stakeKncVal.valueOf());

        stakedKnc = await reserve.makerStakedKNC(maker1);
        assert.equal(stakedKnc.valueOf(), stakeKncVal.valueOf());

        freeKnc = await reserve.makerUnusedKNC(maker1);
        assert.equal(freeKnc.valueOf(), initKnc.sub(stakeKncVal).valueOf());

        // now release
        let releaseAmount = 10 ** 17;
        await reserve.testHandleStakes(maker1, releaseAmount, 0);

        stakedKnc = await reserve.makerStakedKNC(maker1);
        assert.equal(stakedKnc.valueOf(), stakeKncVal.sub(releaseAmount).valueOf());

        let expectedFreeKnc = freeKnc.add(releaseAmount);
        freeKnc = await reserve.makerUnusedKNC(maker1);
        assert.equal(freeKnc.valueOf(), expectedFreeKnc.valueOf());
    });

    it("maker add buy token order. see rate updated. verify order details.", async () => {
        let amountTwei = 5 * 10 ** 19; //500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, amountTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = 2 * 10 ** 18;
        let orderExchangeTwei = 9 * 10 ** 18;

        // first getConversionRate should return 0
//        getConversionRate(ERC20 src, ERC20 dest, uint srcQty, uint blockNumber) public view returns(uint)
        let rate = await reserve.getConversionRate(ethAddress, tokenAdd, 10 ** 18, 0);
        assert.equal(rate.valueOf(), 0);

        //now add order
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});

        let orderDetails = await reserve.getBuyTokenOrder(rc.logs[0].args.orderId.valueOf());
//        log(orderDetails);

        assert.equal(orderDetails[0].valueOf(), maker1);
        assert.equal(orderDetails[1].valueOf(), orderPayAmountWei);
        assert.equal(orderDetails[2].valueOf(), orderExchangeTwei);
        assert.equal(orderDetails[3].valueOf(), headId); // prev should be buy head id - since first
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        rate = await reserve.getConversionRate(ethAddress, token.address, 10 ** 18, 0);
//        log("rate " + rate);
        let expectedRate = precisionUnits.mul(orderExchangeTwei).div(orderPayAmountWei).floor();
        assert.equal(rate.valueOf(), expectedRate.valueOf());
    });

    it("maker add buy token order. see funds updated.", async () => {
        let amountTwei = (new BigNumber(5)).mul(10 ** 19); //500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, amountTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = 2 * 10 ** 18;
        let orderExchangeTwei = 9 * 10 ** 18;

        //check maker free token funds
        let rxFreeTwei = await reserve.makerFunds(maker1, tokenAdd);
        assert.equal(rxFreeTwei.valueOf(), amountTwei.valueOf() );

        //now add order
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});

        let expectedFreeTwei = amountTwei.sub(orderExchangeTwei);

        rxFreeTwei = await reserve.makerFunds(maker1, tokenAdd);
        assert.equal(rxFreeTwei.valueOf(), expectedFreeTwei.valueOf() );
    });

    it("maker add buy token order. cancel order and see canceled.", async () => {
        let amountTwei = (new BigNumber(5)).mul(10 ** 19); //500 tokens

        await makerDeposit(maker1, 0, amountTwei.valueOf(), (600 * 10 ** 18));

        let orderPayAmountWei = 2 * 10 ** 18;
        let orderExchangeTwei = 9 * 10 ** 18;

        //now add order
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});

        let orderList = await reserve.getBuyTokenOrderList();
        assert.equal(orderList.length, 1);

        rc = await reserve.cancelBuyOrder(orderList[0], {from: maker1});
//        log(rc.logs[0].args)

        orderList = await reserve.getBuyTokenOrderList();
        assert.equal(orderList.length, 0);
    });

    it("maker add sell token order. see rate updated. verify order details.", async () => {
        let orderSrcAmountTwei = 9 * 10 ** 18;
        let orderDstWei = 2 * 10 ** 18;

        let amountKnc = 600 * 10 ** 18;
        let amountEth = 2 * 10 ** 18;

        await makerDeposit(maker1, amountEth, 0, amountKnc.valueOf());

        // first getConversionRate should return 0
        let rate = await reserve.getConversionRate(token.address, ethAddress, 10 ** 18, 0);
        assert.equal(rate.valueOf(), 0);

        //now add order
        //////////////
//        makeOrder(address maker, bool isEthToToken, uint128 payAmount, uint128 exchangeAmount, uint32 hintPrevOrder)
        let rc = await reserve.submitSellTokenOrderWHint(orderSrcAmountTwei, orderDstWei, 0, {from: maker1});
//        log(rc.logs[0].args)

        let orderDetails = await reserve.getSellTokenOrder(rc.logs[0].args.orderId.valueOf());
//        log(orderDetails);

        assert.equal(orderDetails[0].valueOf(), maker1);
        assert.equal(orderDetails[1].valueOf(), orderSrcAmountTwei);
        assert.equal(orderDetails[2].valueOf(), orderDstWei);
        assert.equal(orderDetails[3].valueOf(), headId); // prev should be sell head id - since first
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        let orderList = await reserve.getSellTokenOrderList();
        assert.equal(orderList.length, 1); //sell head only
//        log(orderList);

        rate = await reserve.getConversionRate(token.address, ethAddress, 10 ** 18, 0);
//        log("rate " + rate);
        let expectedRate = precisionUnits.mul(orderDstWei).div(orderSrcAmountTwei).floor();
        assert.equal(rate.valueOf(), expectedRate.valueOf());
    });

    it("maker add sell token order. see funds updated.", async () => {
        let orderSrcAmountTwei = 9 * 10 ** 18;
        let orderDstWei = (new BigNumber(2)).mul(10 ** 18);

        let amountKnc = 600 * 10 ** 18;
        let amountEth = (new BigNumber(2.1)).mul(10 ** 18);

        await makerDeposit(maker1, amountEth, 0, amountKnc.valueOf());

        //check maker free token funds
        let rxFreeWei = await reserve.makerFunds(maker1, ethAddress);
        assert.equal(rxFreeWei.valueOf(), amountEth.valueOf() );

        //now add order
        let rc = await reserve.submitSellTokenOrderWHint(orderSrcAmountTwei, orderDstWei, 0, {from: maker1});

        let expectedFreeWei = amountEth.sub(orderDstWei);

        rxFreeWei = await reserve.makerFunds(maker1, ethAddress);
        assert.equal(rxFreeWei.valueOf(), expectedFreeWei.valueOf() );
    });

    it("maker add sell token order. cancel order and see canceled.", async () => {
        let orderSrcAmountTwei = 9 * 10 ** 18;
        let orderDstWei = 2 * 10 ** 18;

        let amountKnc = 600 * 10 ** 18;
        let amountEth = 2 * 10 ** 18;

        await makerDeposit(maker1, amountEth, 0, amountKnc.valueOf());

        //now add order
        let rc = await reserve.submitSellTokenOrder(orderSrcAmountTwei, orderDstWei, {from: maker1});

        let orderList = await reserve.getSellTokenOrderList();
        assert.equal(orderList.length, 1); 

        rc = await reserve.cancelSellOrder(orderList[0], {from: maker1});
//        log(rc.logs[0].args)

        orderList = await reserve.getSellTokenOrderList();
        assert.equal(orderList.length, 0); 
    });

    it("maker add sell order. update to smaller legal amount, see some funds and knc released", async() => {
        let orderSrcAmountTwei = 9 * 10 ** 18;
        let orderDstWei = 3 * 10 ** 18;

        let amountKnc = 600 * 10 ** 18;
        let amountEth = 3 * 10 ** 18;

        await makerDeposit(maker1, amountEth, 0, amountKnc.valueOf());

        //now add order
        let rc = await reserve.submitSellTokenOrder(orderSrcAmountTwei, orderDstWei, {from: maker1});

        let orderId = rc.logs[0].args.orderId.valueOf();

        //update to 2 ether.
        let updatedDest = 2 * 10 ** 18;
        rc = await reserve.updateSellTokenOrder(orderId, orderSrcAmountTwei, updatedDest, {from: maker1});
        log("update single order gas: " + rc.receipt.gasUsed);
        let freeWei = await reserve.makerFunds(maker1, ethAddress);
        assert.equal(freeWei.valueOf(), 10 ** 18);

        let expectedStake = await reserve.calcKncStake(updatedDest);
        let actualStake = await reserve.makerStakedKNC(maker1);
        assert.equal(expectedStake.valueOf(), actualStake.valueOf());

        let orderList = await reserve.getSellTokenOrderList();
        assert.equal(orderList.length, 1);

        rc = await reserve.cancelSellOrder(orderList[0], {from: maker1});
//        log(rc.logs[0].args)

        orderList = await reserve.getSellTokenOrderList();
        assert.equal(orderList.length, 0);
    });

    it("maker add sell order. update to bigger amount, see funds and knc updated", async() => {
        let orderSrcAmountTwei = 9 * 10 ** 18;
        let orderDstWei = 2 * 10 ** 18;

        let amountKnc = 600 * 10 ** 18;
        let amountEth = 3 * 10 ** 18;

        await makerDeposit(maker1, amountEth, 0, amountKnc.valueOf());

        //now add order
        let rc = await reserve.submitSellTokenOrderWHint(orderSrcAmountTwei, orderDstWei, 0, {from: maker1});

        let orderId = rc.logs[0].args.orderId.valueOf();

        //update to 2 ether.
        let updatedDest = 3 * 10 ** 18;
        rc = await reserve.updateSellTokenOrderWHint(orderId, orderSrcAmountTwei, updatedDest, 0, {from: maker1});
        log("update single order gas: " + rc.receipt.gasUsed);

        let freeWei = await reserve.makerFunds(maker1, ethAddress);
        assert.equal(freeWei.valueOf(), 0);

        let expectedStake = await reserve.calcKncStake(updatedDest);
        let actualStake = await reserve.makerStakedKNC(maker1);
        assert.equal(expectedStake.valueOf(), actualStake.valueOf());

        let orderList = await reserve.getSellTokenOrderList();
        assert.equal(orderList.length, 1);

        rc = await reserve.cancelSellOrder(orderList[0], {from: maker1});
//        log(rc.logs[0].args)

        orderList = await reserve.getSellTokenOrderList();
        assert.equal(orderList.length, 0);

    });

    it("maker add sell order. update to smaller illegal amount, see reverted", async() => {
        let orderSrcAmountTwei = 9 * 10 ** 18;
        let orderDstWei = 2 * 10 ** 18;

        let amountKnc = 600 * 10 ** 18;
        let amountEth = 2 * 10 ** 18;

        await makerDeposit(maker1, amountEth, 0, amountKnc.valueOf());

        //now add order
        let rc = await reserve.submitSellTokenOrderWHint(orderSrcAmountTwei, orderDstWei, 0, {from: maker1});

        let orderId = rc.logs[0].args.orderId.valueOf();

        //update to 2 ether.
        let updatedDest = 1 * 10 ** 18;

        try {
            rc = await reserve.updateSellTokenOrderWHint(orderId, orderSrcAmountTwei, updatedDest, 0, {from: maker1});
            assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        let freeWei = await reserve.makerFunds(maker1, ethAddress);
        assert.equal(freeWei.valueOf(), 0);

        let expectedStake = await reserve.calcKncStake(orderDstWei);
        let actualStake = await reserve.makerStakedKNC(maker1);
        assert.equal(expectedStake.valueOf(), actualStake.valueOf());

        let orderList = await reserve.getSellTokenOrderList();
        assert.equal(orderList.length, 1);

        rc = await reserve.cancelSellOrder(orderList[0], {from: maker1});
//        log(rc.logs[0].args)

        orderList = await reserve.getSellTokenOrderList();
        assert.equal(orderList.length, 0);
    });

    it("maker add few buy orders. update order with/out change position. see position correct", async() => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderExchangeTwei = new BigNumber(9 * 10 ** 18);

        // insert 1st order
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order1ID = rc.logs[0].args.orderId.valueOf();

        // insert order as 2nd
        orderPayAmountWei = orderPayAmountWei.add(100);
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order2ID = rc.logs[0].args.orderId.valueOf();

        // insert order as 3rd
        orderPayAmountWei = orderPayAmountWei.add(100);
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order3ID = rc.logs[0].args.orderId.valueOf();

        // insert order as 4th
        orderPayAmountWei = orderPayAmountWei.add(100);
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order4ID = rc.logs[0].args.orderId.valueOf();

        // get order list and see 2nd order is 2nd
        let list = await reserve.getBuyTokenOrderList();
        assert.equal(list[1].valueOf(), order2ID);

        //get 2nd order data.
        orderDetails = await reserve.getBuyTokenOrder(order2ID);
        let order2PayAmount = new BigNumber(orderDetails[1].valueOf());
        order2PayAmount = order2PayAmount.add(50);

        //update order
        await reserve.updateBuyTokenOrder(order2ID, order2PayAmount, orderExchangeTwei, {from: maker1});

        // get order list and see 2nd order is 2nd
        list = await reserve.getBuyTokenOrderList();
        assert.equal(list[1].valueOf(), order2ID);

        //now update so position changes to 3rd
        order2PayAmount = order2PayAmount.add(70);

        //update order
        await reserve.updateBuyTokenOrder(order2ID, order2PayAmount, orderExchangeTwei, {from: maker1});

        // get order list and see 2nd order is 3rd now
        list = await reserve.getBuyTokenOrderList();
        assert.equal(list[2].valueOf(), order2ID);

        //now update so position changes to 1st
        order2PayAmount = order2PayAmount.sub(1000);

        //update order
        await reserve.updateBuyTokenOrder(order2ID, order2PayAmount, orderExchangeTwei, {from: maker1});

        // get order list and see 2nd order is 1st now
        list = await reserve.getBuyTokenOrderList();
        assert.equal(list[0].valueOf(), order2ID);
    });

    it("maker add few buy orders. update order with correct hints. only amounts and move. see success and print gas", async() => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderExchangeTwei = new BigNumber(9 * 10 ** 18);

        // insert 1st order
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order1ID = rc.logs[0].args.orderId.valueOf();

        // insert order as 2nd
        orderPayAmountWei = orderPayAmountWei.add(100);
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order2ID = rc.logs[0].args.orderId.valueOf();

        // insert order as 3rd
        orderPayAmountWei = orderPayAmountWei.add(100);
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order3ID = rc.logs[0].args.orderId.valueOf();

        // insert order as 4th
        orderPayAmountWei = orderPayAmountWei.add(100);
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order4ID = rc.logs[0].args.orderId.valueOf();

        // get order list and see 2nd order is 2nd
        let list = await reserve.getBuyTokenOrderList();
//        log("list " + list)
        assert.equal(list[1].valueOf(), order2ID);

        //get 2nd order data.
        orderDetails = await reserve.getBuyTokenOrder(order2ID);
        let order2PayAmount = new BigNumber(orderDetails[1].valueOf());
        order2PayAmount = order2PayAmount.add(50);

        //update order only amounts
        rc = await reserve.updateBuyTokenOrderWHint(order2ID, order2PayAmount, orderExchangeTwei, order1ID, {from: maker1});
        log("update amounts only: " + rc.receipt.gasUsed);

        // get order list and see 2nd order is 2nd
        list = await reserve.getBuyTokenOrderList();
//        log("list " + list)
        assert.equal(list[1].valueOf(), order2ID);

        //now update so position changes to 3rd
        order2PayAmount = order2PayAmount.add(70);

        //update order
        rc = await reserve.updateBuyTokenOrderWHint(order2ID, order2PayAmount, orderExchangeTwei, order3ID, {from: maker1});
        log("update position with hint to 3rd: " + rc.receipt.gasUsed);

        // get order list and see 2nd order is 3rd now
        list = await reserve.getBuyTokenOrderList();
        assert.equal(list[2].valueOf(), order2ID);

        //now update so position changes to 1st
        order2PayAmount = order2PayAmount.sub(1000);

        //update order
        rc = await reserve.updateBuyTokenOrderWHint(order2ID, order2PayAmount, orderExchangeTwei, headId, {from: maker1});
        log("update position with hint to first: " + rc.receipt.gasUsed);

        // get order list and see 2nd order is 1st now
        list = await reserve.getBuyTokenOrderList();
//        log("list" + list)
        assert.equal(list[0].valueOf(), order2ID);
    });

    it("maker add 2 buy orders. get hint for next buy order and see correct", async() => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderExchangeTwei = new BigNumber(9 * 10 ** 18);

        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order1ID = rc.logs[0].args.orderId.valueOf();

        // insert order as last in list
        orderPayAmountWei = orderPayAmountWei.add(2000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order2ID = rc.logs[0].args.orderId.valueOf();
        orderDetails = await reserve.getBuyTokenOrder(rc.logs[0].args.orderId.valueOf());
        assert.equal(orderDetails[3].valueOf(), order1ID);
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        // get add hint if set as first
        orderPayAmountWei = orderPayAmountWei.sub(3000);
        let prevOrder = await reserve.getAddOrderHintBuyToken(orderPayAmountWei, orderExchangeTwei);
        assert.equal(prevOrder.valueOf(), headId);

        // get add hint if set as 2nd
        orderPayAmountWei = orderPayAmountWei.add(2000);
        prevOrder = await reserve.getAddOrderHintBuyToken(orderPayAmountWei, orderExchangeTwei);
        assert.equal(prevOrder.valueOf(), order1ID);

        // get add hint if set as 3rd = last
        orderPayAmountWei = orderPayAmountWei.add(2000);
        prevOrder = await reserve.getAddOrderHintBuyToken(orderPayAmountWei, orderExchangeTwei);
        assert.equal(prevOrder.valueOf(), order2ID);
    });

    it("maker add 2 sell orders. get hint for next sell order and see correct", async() => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;
        let amountEth = (new BigNumber(6 * 10 ** 18)).add(3000);

        await makerDeposit(maker1, amountEth.valueOf(), fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderExchangeWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderPayAmountTwei = new BigNumber(9 * 10 ** 18);

        let rc = await reserve.submitSellTokenOrder(orderPayAmountTwei, orderExchangeWei, {from: maker1});
        let order1ID = rc.logs[0].args.orderId.valueOf();

        orderPayAmountTwei = orderPayAmountTwei.add(2000);

        rc = await reserve.submitSellTokenOrder(orderPayAmountTwei, orderExchangeWei, {from: maker1});
        let order2ID = rc.logs[0].args.orderId.valueOf();
        orderDetails = await reserve.getSellTokenOrder(rc.logs[0].args.orderId.valueOf());
        assert.equal(orderDetails[3].valueOf(), order1ID);
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        // get add hint if set as first
        orderPayAmountTwei = orderPayAmountTwei.sub(3000);
        let prevOrder = await reserve.getAddOrderHintSellToken(orderPayAmountTwei, orderExchangeWei);
        assert.equal(prevOrder.valueOf(), headId);

        // get add hint if set as 2nd
        orderPayAmountTwei = orderPayAmountTwei.add(2000);
        prevOrder = await reserve.getAddOrderHintSellToken(orderPayAmountTwei, orderExchangeWei);
        assert.equal(prevOrder.valueOf(), order1ID);

        // get add hint if set as 3rd = last
        orderPayAmountTwei = orderPayAmountTwei.add(2000);
        prevOrder = await reserve.getAddOrderHintSellToken(orderPayAmountTwei, orderExchangeWei);
        assert.equal(prevOrder.valueOf(), order2ID);
    });

    it("maker add 3 buy orders. get hint for updating last order to different amounts", async() => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderExchangeTwei = new BigNumber(9 * 10 ** 18);

        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order1ID = rc.logs[0].args.orderId.valueOf();

        // insert order as 2nd in list
        orderPayAmountWei = orderPayAmountWei.add(2000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order2ID = rc.logs[0].args.orderId.valueOf();
        orderDetails = await reserve.getBuyTokenOrder(rc.logs[0].args.orderId.valueOf());
        assert.equal(orderDetails[3].valueOf(), order1ID);
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        // insert order as 3rd in list
        orderPayAmountWei = orderPayAmountWei.add(2000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order3ID = rc.logs[0].args.orderId.valueOf();
        orderDetails = await reserve.getBuyTokenOrder(rc.logs[0].args.orderId.valueOf());
        assert.equal(orderDetails[3].valueOf(), order2ID);
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        // get update hint with small amount change.
        orderPayAmountWei = orderPayAmountWei.add(100);
        let prevOrder = await reserve.getUpdateOrderHintBuyToken(order3ID, orderPayAmountWei, orderExchangeTwei);
        assert.equal(prevOrder.valueOf(), order2ID);

        // get update hint
        orderPayAmountWei = orderPayAmountWei.sub(2200);
        prevOrder = await reserve.getUpdateOrderHintBuyToken(order3ID, orderPayAmountWei, orderExchangeTwei);
        assert.equal(prevOrder.valueOf(), order1ID);

        // get update hint
        orderPayAmountWei = orderPayAmountWei.sub(2000);
        prevOrder = await reserve.getUpdateOrderHintBuyToken(order3ID, orderPayAmountWei, orderExchangeTwei);
        assert.equal(prevOrder.valueOf(), headId);
    });


    it("maker add 3 sell orders. get hint for updating last order to different amounts", async() => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;
        let amountEth = (new BigNumber(6 * 10 ** 18)).add(3000);

        await makerDeposit(maker1, amountEth.valueOf(), fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderExchangeWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderPayAmountTwei = new BigNumber(9 * 10 ** 18);

        let rc = await reserve.submitBuyTokenOrder(orderPayAmountTwei, orderExchangeWei, {from: maker1});
        let order1ID = rc.logs[0].args.orderId.valueOf();

        // insert order as 2nd in list
        orderPayAmountTwei = orderPayAmountTwei.add(2000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountTwei, orderExchangeWei, {from: maker1});
        let order2ID = rc.logs[0].args.orderId.valueOf();
        orderDetails = await reserve.getBuyTokenOrder(rc.logs[0].args.orderId.valueOf());
        assert.equal(orderDetails[3].valueOf(), order1ID);
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        // insert order as 3rd in list
        orderPayAmountTwei = orderPayAmountTwei.add(2000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountTwei, orderExchangeWei, {from: maker1});
        let order3ID = rc.logs[0].args.orderId.valueOf();
        orderDetails = await reserve.getBuyTokenOrder(rc.logs[0].args.orderId.valueOf());
        assert.equal(orderDetails[3].valueOf(), order2ID);
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        // get update hint with small amount change.
        orderPayAmountTwei = orderPayAmountTwei.add(100);
        let prevOrder = await reserve.getUpdateOrderHintBuyToken(order3ID, orderPayAmountTwei, orderExchangeWei);
        assert.equal(prevOrder.valueOf(), order2ID);

        // get update hint
        orderPayAmountTwei = orderPayAmountTwei.sub(2200);
        prevOrder = await reserve.getUpdateOrderHintBuyToken(order3ID, orderPayAmountTwei, orderExchangeWei);
        assert.equal(prevOrder.valueOf(), order1ID);

        // get update hint
        orderPayAmountTwei = orderPayAmountTwei.sub(2000);
        prevOrder = await reserve.getUpdateOrderHintBuyToken(order3ID, orderPayAmountTwei, orderExchangeWei);
        assert.equal(prevOrder.valueOf(), headId);
    });


    it("maker add few buy orders. update order with wrong hint. see success and print gas", async() => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderExchangeTwei = new BigNumber(9 * 10 ** 18);

        // insert 1st order
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order1ID = rc.logs[0].args.orderId.valueOf();

        // insert order as 2nd
        orderPayAmountWei = orderPayAmountWei.add(100);
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order2ID = rc.logs[0].args.orderId.valueOf();

        // insert order as 3rd
        orderPayAmountWei = orderPayAmountWei.add(100);
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order3ID = rc.logs[0].args.orderId.valueOf();

        // insert order as 4th
        orderPayAmountWei = orderPayAmountWei.add(100);
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order4ID = rc.logs[0].args.orderId.valueOf();

        // get order list and see 2nd order is 2nd
        let list = await reserve.getBuyTokenOrderList();
//        log("list " + list)
        assert.equal(list[1].valueOf(), order2ID);

        //get 2nd order data.
        orderDetails = await reserve.getBuyTokenOrder(order2ID);
        let order2PayAmount = new BigNumber(orderDetails[1].valueOf());
        order2PayAmount = order2PayAmount.add(120);

        //update order to 3rd place. wrong hint
        rc = await reserve.updateBuyTokenOrderWHint(order2ID, order2PayAmount, orderExchangeTwei, headId, {from: maker1});
        log("update position with wrong hint: " + rc.receipt.gasUsed);

        // get order list and see order2 is 3rd now
        list = await reserve.getBuyTokenOrderList();
        assert.equal(list[2].valueOf(), order2ID);

        //now update so position changes to 1st with wrong hint
        order2PayAmount = order2PayAmount.sub(1000);

        //update order
        rc = await reserve.updateBuyTokenOrderWHint(order2ID, order2PayAmount, orderExchangeTwei, order3ID, {from: maker1});
        log("update position again with wrong hint: " + rc.receipt.gasUsed);

        // get order list and see order2 is 1st now
        list = await reserve.getBuyTokenOrderList();
//        log("list" + list)
        assert.equal(list[0].valueOf(), order2ID);
    });

    it("maker add buy order. update order with another maker. see reverted.", async() => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderExchangeTwei = new BigNumber(9 * 10 ** 18);

        // insert 1st order
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order1ID = rc.logs[0].args.orderId.valueOf();

        orderPayAmountWei = orderPayAmountWei.add(500);

        try {
            await reserve.updateBuyTokenOrderWHint(order1ID, orderPayAmountWei, orderExchangeTwei, headId, {from: maker2});
            assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        try {
            await reserve.updateBuyTokenOrder(order1ID, orderPayAmountWei, orderExchangeTwei, {from: maker2});
            assert(false, "throw was expected in line above.")
        } catch(e){
            assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
        }

        //update order to 3rd place. wrong hint
        rc = await reserve.updateBuyTokenOrderWHint(order1ID, orderPayAmountWei, orderExchangeTwei, headId, {from: maker1});

        // get order list and see 2nd order is 1st now
        list = await reserve.getBuyTokenOrderList();
    });

    it("maker add few buy and sell orders and perform batch update - only amounts. compare gas no hint and good hint.", async() => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;
        let amountEth = (new BigNumber(4 * 10 ** 18)).add(3000);

        await makerDeposit(maker1, amountEth.valueOf(), fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderSellTwei = new BigNumber(9 * 10 ** 18);

        // insert buy orders
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderSellTwei, {from: maker1});
        let buyOrder1ID = rc.logs[0].args.orderId.valueOf();
        orderPayAmountWei = orderPayAmountWei.add(100);
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderSellTwei, {from: maker1});
        let buyOrder2ID = rc.logs[0].args.orderId.valueOf();

        // insert sell orders
        let orderPayAmountTwei = (new BigNumber(9 * 10 ** 18));
        let orderSellWei = new BigNumber(2 * 10 ** 18);

        rc = await reserve.submitSellTokenOrder(orderPayAmountTwei, orderSellWei, {from: maker1});
        let sellOrder1ID = rc.logs[0].args.orderId.valueOf();
        orderPayAmountWei = orderPayAmountTwei.add(100);
        rc = await reserve.submitSellTokenOrder(orderPayAmountTwei, orderSellWei, {from: maker1});
        let sellOrder2ID = rc.logs[0].args.orderId.valueOf();

        //test positions.
        let list = await reserve.getBuyTokenOrderList();
        assert.equal(list[0].valueOf(), buyOrder1ID);
        assert.equal(list[1].valueOf(), buyOrder2ID);

        list = await reserve.getSellTokenOrderList();
        assert.equal(list[0].valueOf(), sellOrder1ID);
        assert.equal(list[1].valueOf(), sellOrder2ID);

        //create batch update only amounts. no hints.
        let orderTypeArray = [true, true, false, false];
        let ordersArray = [buyOrder1ID, buyOrder2ID, sellOrder1ID, sellOrder2ID];
        let orderNewSrcAmountsArr = [orderPayAmountWei.add(20).valueOf(), orderPayAmountWei.add(120).valueOf(),
                                        orderPayAmountTwei.add(30).valueOf(), orderPayAmountTwei.add(105).valueOf()];
        let orderNewDstAmountsArr = [orderSellTwei.add(1).valueOf(), orderSellTwei.add(1).valueOf(),
                    orderSellWei.add(1).valueOf(), orderSellWei.add(1).valueOf()];
        let orderHintArray = [0, 0, 0, 0];

//        log (orderTypeArray)
//        log (ordersArray)
//        log (orderNewSrcAmountsArr)
//        log (orderNewDstAmountsArr)
//        log (orderHintArray)
//updateOrderBatch(bool[] isBuyOrder, uint32[] orderId, uint128[] newSrcAmount, uint128[] newDstAmount, uint32[] hintPrevOrder)
        rc = await reserve.updateOrderBatch(orderTypeArray, ordersArray, orderNewSrcAmountsArr, orderNewDstAmountsArr, orderHintArray, {from: maker1})
        let updateBatchNoHintGas = rc.receipt.gasUsed;
        log("update 4 orders batch - only amounts, no hint: " + updateBatchNoHintGas);

        //test positions.
        list = await reserve.getBuyTokenOrderList();
        assert.equal(list[0].valueOf(), buyOrder1ID);
        assert.equal(list[1].valueOf(), buyOrder2ID);

        list = await reserve.getSellTokenOrderList();
        assert.equal(list[0].valueOf(), sellOrder1ID);
        assert.equal(list[1].valueOf(), sellOrder2ID);

        //now update again with good hint array only amounts. print gas.
        orderNewSrcAmountsArr = [orderPayAmountWei.add(7).valueOf(), orderPayAmountWei.add(107).valueOf(),
                                     orderPayAmountTwei.add(11).valueOf(), orderPayAmountTwei.add(111).valueOf()];
        orderNewDstAmountsArr = [orderSellTwei.add(3).valueOf(), orderSellTwei.add(3).valueOf(),
                    orderSellWei.add(3).valueOf(), orderSellWei.add(3).valueOf()];
        orderHintArray = [headId, buyOrder1ID, headId, sellOrder1ID];
        rc = await reserve.updateOrderBatch(orderTypeArray, ordersArray, orderNewSrcAmountsArr, orderNewDstAmountsArr, orderHintArray, {from: maker1})
        let updateBatchWithHintGas = rc.receipt.gasUsed;
        log("update 4 orders batch - only amounts, good hint: " + updateBatchWithHintGas);

        //test positions.
        list = await reserve.getBuyTokenOrderList();
//        log(list)
        assert.equal(list[0].valueOf(), buyOrder1ID);
        assert.equal(list[1].valueOf(), buyOrder2ID);

        list = await reserve.getSellTokenOrderList();
//        log(list)
        assert.equal(list[0].valueOf(), sellOrder1ID);
        assert.equal(list[1].valueOf(), sellOrder2ID);

        assert(updateBatchWithHintGas < (updateBatchNoHintGas - 100000));
    });

    it("maker add few buy and sell orders and perform batch update + move position. compare gas no hint and good hint.", async() => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;
        let amountEth = (new BigNumber(4 * 10 ** 18)).add(3000);

        await makerDeposit(maker1, amountEth.valueOf(), fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderSellTwei = new BigNumber(9 * 10 ** 18);

        // insert 2 buy orders
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderSellTwei, {from: maker1});
        let buyOrder1ID = rc.logs[0].args.orderId.valueOf();
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei.add(100), orderSellTwei, {from: maker1});
        let buyOrder2ID = rc.logs[0].args.orderId.valueOf();

        // insert 2 sell orders
        let orderPayAmountTwei = (new BigNumber(9 * 10 ** 18));
        let orderSellWei = new BigNumber(2 * 10 ** 18);

        rc = await reserve.submitSellTokenOrder(orderPayAmountTwei, orderSellWei, {from: maker1});
        let sellOrder1ID = rc.logs[0].args.orderId.valueOf();
        rc = await reserve.submitSellTokenOrder(orderPayAmountTwei.add(100), orderSellWei, {from: maker1});
        let sellOrder2ID = rc.logs[0].args.orderId.valueOf();

        //verify positions.
        let list = await reserve.getBuyTokenOrderList();
        assert.equal(list[0].valueOf(), buyOrder1ID);
        assert.equal(list[1].valueOf(), buyOrder2ID);

        list = await reserve.getSellTokenOrderList();
        assert.equal(list[0].valueOf(), sellOrder1ID);
        assert.equal(list[1].valueOf(), sellOrder2ID);

        //create batch update so both sell orders and buy orders swap places. no hints.
        let orderTypeArray = [true, true, false, false];
        let ordersArray = [buyOrder1ID, buyOrder2ID, sellOrder1ID, sellOrder2ID];
        let orderNewSrcAmountsArr = [orderPayAmountWei.add(110).valueOf(), orderPayAmountWei.add(120).valueOf(),
                    orderPayAmountTwei.add(110).valueOf(), orderPayAmountTwei.add(120).valueOf()];
        let orderNewDstAmountsArr = [orderSellTwei.add(1).valueOf(), orderSellTwei.add(1).valueOf(),
                    orderSellWei.add(1).valueOf(), orderSellWei.add(1).valueOf()];
        let orderHintArray = [0, 0, 0, 0];

//        log (orderTypeArray)
//        log (ordersArray)
//        log (orderNewSrcAmountsArr)
//        log (orderNewDstAmountsArr)
//        log (orderHintArray)
//updateOrderBatch(bool[] isBuyOrder, uint32[] orderId, uint128[] newSrcAmount, uint128[] newDstAmount, uint32[] hintPrevOrder)
        rc = await reserve.updateOrderBatch(orderTypeArray, ordersArray, orderNewSrcAmountsArr, orderNewDstAmountsArr, orderHintArray, {from: maker1})
        let updateBatchNoHintGas = rc.receipt.gasUsed;
        log("update 4 orders batch, no hint: " + updateBatchNoHintGas);

        //test positions.
        list = await reserve.getBuyTokenOrderList();
        assert.equal(list[0].valueOf(), buyOrder1ID);
        assert.equal(list[1].valueOf(), buyOrder2ID);

        list = await reserve.getSellTokenOrderList();
        assert.equal(list[0].valueOf(), sellOrder1ID);
        assert.equal(list[1].valueOf(), sellOrder2ID);

        //now update again with good hint array. print gas.
        orderNewSrcAmountsArr = [orderPayAmountWei.add(130).valueOf(), orderPayAmountWei.add(140).valueOf(),
                            orderPayAmountTwei.add(130).valueOf(), orderPayAmountTwei.add(140).valueOf()];
        orderNewDstAmountsArr = [orderSellTwei.add(3).valueOf(), orderSellTwei.add(3).valueOf(),
                                orderSellWei.add(3).valueOf(), orderSellWei.add(3).valueOf()];
        orderHintArray = [buyOrder2ID, buyOrder1ID, sellOrder2ID, sellOrder1ID];
        rc = await reserve.updateOrderBatch(orderTypeArray, ordersArray, orderNewSrcAmountsArr, orderNewDstAmountsArr, orderHintArray, {from: maker1})
        let updateBatchWithHintGas = rc.receipt.gasUsed;
        log("update 4 orders batch, good hint: " + updateBatchWithHintGas);

        //test positions.
        list = await reserve.getBuyTokenOrderList();
//        log(list)
        assert.equal(list[0].valueOf(), buyOrder1ID);
        assert.equal(list[1].valueOf(), buyOrder2ID);

        list = await reserve.getSellTokenOrderList();
//        log(list)
        assert.equal(list[0].valueOf(), sellOrder1ID);
        assert.equal(list[1].valueOf(), sellOrder2ID);

        assert(updateBatchWithHintGas < (updateBatchNoHintGas - 3000));
    });

    it("maker add a few buy orders. see orders added in correct position. print gas price per order", async () => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderExchangeTwei = new BigNumber(9 * 10 ** 18);

        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});

        let order1ID = rc.logs[0].args.orderId.valueOf();

        let orderDetails = await reserve.getBuyTokenOrder(rc.logs[0].args.orderId.valueOf());
    //        log(orderDetails);

        assert.equal(orderDetails[0].valueOf(), maker1);
        assert.equal(orderDetails[1].valueOf(), orderPayAmountWei);
        assert.equal(orderDetails[2].valueOf(), orderExchangeTwei);
        assert.equal(orderDetails[3].valueOf(), headId); // prev should be buy head id - since first
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        // insert order as last in list
        orderPayAmountWei = orderPayAmountWei.add(2000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        let order2ID = rc.logs[0].args.orderId.valueOf();

        orderDetails = await reserve.getBuyTokenOrder(rc.logs[0].args.orderId.valueOf());

        assert.equal(orderDetails[3].valueOf(), order1ID);
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        // insert order as last in list
        orderPayAmountWei = orderPayAmountWei.add(2000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});

        let order3ID = rc.logs[0].args.orderId.valueOf();
        orderDetails = await reserve.getBuyTokenOrder(rc.logs[0].args.orderId.valueOf());

        assert.equal(orderDetails[3].valueOf(), order2ID);
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        //get order list
        let orderList = await reserve.getBuyTokenOrderList();
//        log ("list \n" + orderList);
        //get first order details
        orderDetails = await reserve.getBuyTokenOrder(orderList[0].valueOf());

        // insert order as first in list
        let bestOrderPayAmount = orderDetails[1];
        let bestOrderDstAmount = orderDetails[2].add(200).valueOf();

        rc = await reserve.submitBuyTokenOrderWHint(bestOrderPayAmount, bestOrderDstAmount, 0, {from: maker1});
        let order4ID = rc.logs[0].args.orderId.valueOf();

//        log("order4 " + order4ID)

        orderDetails = await reserve.getBuyTokenOrder(rc.logs[0].args.orderId.valueOf());

        assert.equal(orderDetails[3].valueOf(), headId); // prev should be buy head id - since first
        assert.equal(orderDetails[4].valueOf(), order1ID); // next should be tail ID - since last

        //now insert order as 2nd best.
        let secondBestPayAmount = bestOrderPayAmount.add(30).valueOf();
        rc = await reserve.submitBuyTokenOrderWHint(secondBestPayAmount, bestOrderDstAmount, 0, {from: maker1});
        let order5ID = rc.logs[0].args.orderId.valueOf();

        orderDetails = await reserve.getBuyTokenOrder(rc.logs[0].args.orderId.valueOf());

        assert.equal(orderDetails[3].valueOf(), order4ID); // prev should be buy head id - since first
        assert.equal(orderDetails[4].valueOf(), order1ID); // next should be tail ID - since last
    });

    it("maker - check gas price for order reuse is better.", async () => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        let orderExchangeTwei = new BigNumber(9 * 10 ** 18);

        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        log("make buy order gas(order 1 in list): ID: " + rc.logs[0].args.orderId.valueOf() + " gas: "+ rc.receipt.gasUsed);

        // insert order as last in list
        orderPayAmountWei = orderPayAmountWei.add(2000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        log("make buy order gas(order 2 in list): ID: " + rc.logs[0].args.orderId.valueOf() + " gas: "+ rc.receipt.gasUsed);

        // insert order as last in list
        orderPayAmountWei = orderPayAmountWei.add(2000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        log("make buy order gas(order 3 in list): ID: " + rc.logs[0].args.orderId.valueOf() + " gas: "+ rc.receipt.gasUsed);

        orderPayAmountWei = orderPayAmountWei.sub(6000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        log("make buy order gas(order 1 in list): ID: " + rc.logs[0].args.orderId.valueOf() + " gas: "+ rc.receipt.gasUsed);

        //now insert order as 2nd best.
        orderPayAmountWei = orderPayAmountWei.add(30).valueOf();
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        log("make buy order gas(order 2 in list): ID: " + rc.logs[0].args.orderId.valueOf() + " gas: "+ rc.receipt.gasUsed);

        let orderList = await reserve.getBuyTokenOrderList();
//        log("orderList")
//        log(orderList)
        for (let i = 0; i < orderList.length; i++) {
            //start from 1 since first order is head
            await reserve.cancelBuyOrder(orderList[i].valueOf(), {from: maker1});
        }

        log("cancel all orders and add again.")
        orderPayAmountWei = (new BigNumber(2 * 10 ** 18)).add(2000); // 2 ether
        orderExchangeTwei = new BigNumber(9 * 10 ** 18);
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        log("make buy order gas(order 1 in list). ID: " + rc.logs[0].args.orderId.valueOf() + " gas: "+ rc.receipt.gasUsed);

        // insert order as last in list
        orderPayAmountWei = orderPayAmountWei.add(2000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        log("make buy order gas(order 2 in list). ID: " + rc.logs[0].args.orderId.valueOf() + " gas: "+ rc.receipt.gasUsed);

        // insert order as last in list
        orderPayAmountWei = orderPayAmountWei.add(2000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        log("make buy order gas(order 3 in list): ID: " + rc.logs[0].args.orderId.valueOf() + " gas: "+ rc.receipt.gasUsed);

        orderPayAmountWei = orderPayAmountWei.sub(6000);

        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        log("make buy order gas(order 1 in list): ID: " + rc.logs[0].args.orderId.valueOf() + " gas: "+ rc.receipt.gasUsed);

        //now insert order as 2nd best.
        orderPayAmountWei = orderPayAmountWei.add(30).valueOf();
        rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        log("make buy order gas(order 2 in list): ID: " + rc.logs[0].args.orderId.valueOf() + " gas: "+ rc.receipt.gasUsed);

        orderList = await reserve.getBuyTokenOrderList();
//        log("orderList")
//        log(orderList)

        for (let i = 0; i < orderList.length ; i++) {
            await reserve.cancelBuyOrder(orderList[i].valueOf(), {from: maker1});
        }
    });

    it("maker - compare gas price for 5 buy orders. one be one in order vs batch add.", async () => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;

        orderSrc = new BigNumber(2 * 10 ** 18);
        orderDst = new BigNumber(6 * 10 ** 18);

        await makerDeposit(maker1, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());

        makeOrdersSrcAmounts = [orderSrc, orderSrc, orderSrc, orderSrc, orderSrc];
        makeOrdersDstAmount = [orderDst, orderDst.sub(200), orderDst.sub(500), orderDst.sub(900), orderDst.sub(1300)];

        let totalGasMaker1 = new BigNumber(0);
        for (let i = 0; i < makeOrdersSrcAmounts.length; i++) {
            let rc = await reserve.submitBuyTokenOrderWHint(makeOrdersSrcAmounts[i], makeOrdersDstAmount[i], 0, {from: maker1});
            totalGasMaker1 = totalGasMaker1.add(rc.receipt.gasUsed);
        }

        log ("total gas 5 maker orders. one by one: " + totalGasMaker1.valueOf());
        let totalOrderValue = orderSrc.mul(5);

        let rc = await reserve.trade(ethAddress, totalOrderValue, tokenAdd, user1, 300, false,
                                {value: totalOrderValue});
        log("take 5 orders gas: " + rc.receipt.gasUsed);

        //now run batch with maker2
        let hintArray = [0, 0, 0, 0, 0];
        let isAfterMyPrevOrder = [false, false, false, false, false];
        let isBuyOrder = [true, true, true, true, true];

        await makerDeposit(maker2, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());
        rc = await reserve.addOrderBatch(isBuyOrder, makeOrdersSrcAmounts, makeOrdersDstAmount, hintArray, isAfterMyPrevOrder, {from: maker2});

        let gasCostBatchAdd = rc.receipt.gasUsed;
        log("add 5 orders batch. gas price: " + rc.receipt.gasUsed);

        orderList = await reserve.getBuyTokenOrderList();
        for (let i = 0; i < orderList.length ; i++) {
            await reserve.cancelBuyOrder(orderList[i].valueOf(), {from: maker2});
        }

        log ("adding 5 orders. batch add less gas: "  + (totalGasMaker1 - gasCostBatchAdd))
    });

    it("make order - compare gas price. add 5th order with / without hint.", async () => {
        let fundDepositTwei = new BigNumber(500).mul(10 ** 18); // 500 tokens
        let amountKnc = 600 * 10 ** 18;

        orderSrc = new BigNumber(2 * 10 ** 18);
        orderDst = new BigNumber(6 * 10 ** 18);

        await makerDeposit(maker1, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());

        makeOrdersSrcAmounts = [orderSrc, orderSrc, orderSrc, orderSrc, orderSrc];
        makeOrdersDstAmount = [orderDst, orderDst.sub(200), orderDst.sub(500), orderDst.sub(900), orderDst.sub(1300)];

        for (let i = 0; i < makeOrdersSrcAmounts.length - 1; i++) {
            let rc = await reserve.submitBuyTokenOrderWHint(makeOrdersSrcAmounts[i], makeOrdersDstAmount[i], 0, {from: maker1});
        }

        let lastOrder = makeOrdersSrcAmounts.length - 1;
        let rc = await reserve.submitBuyTokenOrderWHint(makeOrdersSrcAmounts[lastOrder], makeOrdersDstAmount[lastOrder], 0, {from: maker1});
        let gasWithoutHint = rc.receipt.gasUsed;
        log("5th order without hint: " + rc.receipt.gasUsed);

        orderList = await reserve.getBuyTokenOrderList();
        for (let i = 0; i < orderList.length ; i++) {
            await reserve.cancelBuyOrder(orderList[i].valueOf(), {from: maker1});
        }

        //now run same data with maker 2. add last with hint
        await makerDeposit(maker2, 0, fundDepositTwei.valueOf(), amountKnc.valueOf());

        makeOrdersSrcAmounts = [orderSrc, orderSrc, orderSrc, orderSrc, orderSrc];
        makeOrdersDstAmount = [orderDst, orderDst.sub(200), orderDst.sub(500), orderDst.sub(900), orderDst.sub(1300)];

        for (let i = 0; i < makeOrdersSrcAmounts.length - 1; i++) {
            rc = await reserve.submitBuyTokenOrderWHint(makeOrdersSrcAmounts[i], makeOrdersDstAmount[i], 0, {from: maker2});
        }

        lastOrder = makeOrdersSrcAmounts.length - 1;
        let prevId = rc.logs[0].args.orderId.valueOf();

        rc = await reserve.submitBuyTokenOrderWHint(makeOrdersSrcAmounts[lastOrder], makeOrdersDstAmount[lastOrder],
            prevId, {from: maker2});

        log("5th order with hint: " + rc.receipt.gasUsed);
        let gasWithHint = rc.receipt.gasUsed;

        log("gas diff 5th order. with / without hint: " + (gasWithoutHint - gasWithHint));

        orderList = await reserve.getBuyTokenOrderList();
        for (let i = 0; i < orderList.length ; i++) {
            await reserve.cancelBuyOrder(orderList[i].valueOf(), {from: maker2});
        }
    });

    it("maker add a few sell orders. see orders added in correct position.", async () => {
        let amountKnc = 600 * 10 ** 18;
        let amountEth = 14 * 10 ** 18;

        await makerDeposit(maker1, amountEth, 0, amountKnc.valueOf());

        let orderSrcAmountTwei = new BigNumber(9).mul(10 ** 18);
        let orderDstWei = new BigNumber(2).mul(10 ** 18);

        let rc = await reserve.submitSellTokenOrderWHint(orderSrcAmountTwei, orderDstWei, 0, {from: maker1});

        let order1ID = rc.logs[0].args.orderId.valueOf();

        let orderDetails = await reserve.getSellTokenOrder(rc.logs[0].args.orderId.valueOf());
    //        log(orderDetails);

        assert.equal(orderDetails[0].valueOf(), maker1);
        assert.equal(orderDetails[1].valueOf(), orderSrcAmountTwei);
        assert.equal(orderDetails[2].valueOf(), orderDstWei);
        assert.equal(orderDetails[3].valueOf(), headId); // prev should be buy head id - since first
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        // insert order as last in list
        orderSrcAmountTwei = orderSrcAmountTwei.add(2000);

        rc = await reserve.submitSellTokenOrderWHint(orderSrcAmountTwei, orderDstWei, 0, {from: maker1});

        let order2ID = rc.logs[0].args.orderId.valueOf();

        orderDetails = await reserve.getSellTokenOrder(rc.logs[0].args.orderId.valueOf());
        //        log(orderDetails);

        assert.equal(orderDetails[3].valueOf(), order1ID); // prev should be buy head id - since first
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        // insert another order as last in list
        orderSrcAmountTwei = orderSrcAmountTwei.add(2000);

        rc = await reserve.submitSellTokenOrderWHint(orderSrcAmountTwei, orderDstWei, 0, {from: maker1});
        let order3ID = rc.logs[0].args.orderId.valueOf();

        orderDetails = await reserve.getSellTokenOrder(rc.logs[0].args.orderId.valueOf());
        //        log(orderDetails);

        assert.equal(orderDetails[3].valueOf(), order2ID); // prev should be buy head id - since first
        assert.equal(orderDetails[4].valueOf(), tailId); // next should be tail ID - since last

        //get order list
        let orderList = await reserve.getSellTokenOrderList();
//        log ("list \n" + orderList);
        //get first order details
        orderDetails = await reserve.getSellTokenOrder(orderList[0].valueOf());

        // insert order as first in list
        let bestOrderPayAmount = orderDetails[1];
        let bestOrderDstAmount = orderDetails[2].add(200).valueOf();

        rc = await reserve.submitSellTokenOrderWHint(bestOrderPayAmount, bestOrderDstAmount, 0, {from: maker1});
        let order4ID = rc.logs[0].args.orderId.valueOf();
//        log("order4 " + order4ID)

        orderDetails = await reserve.getSellTokenOrder(rc.logs[0].args.orderId.valueOf());

        assert.equal(orderDetails[3].valueOf(), headId); // prev should be buy head id - since first
        assert.equal(orderDetails[4].valueOf(), order1ID); // next should be tail ID - since last

        //now insert order as 2nd best.
        let secondBestPayAmount = bestOrderPayAmount.add(30).valueOf();
        rc = await reserve.submitSellTokenOrderWHint(secondBestPayAmount, bestOrderDstAmount, 0, {from: maker1});
        let order5ID = rc.logs[0].args.orderId.valueOf();
        //        log("order4 " + order4ID)

        orderDetails = await reserve.getSellTokenOrder(rc.logs[0].args.orderId.valueOf());

        assert.equal(orderDetails[3].valueOf(), order4ID); // prev should be buy head id - since first
        assert.equal(orderDetails[4].valueOf(), order1ID); // next should be tail ID - since last

        orderList = await reserve.getSellTokenOrderList();
        for (let i = 0; i < orderList.length - 1; i++) {
            await reserve.cancelSellOrder(orderList[i], {from: maker1});
        }
    });

    it("calc expected stake and calc burn amount. validate match", async () => {
        let kncToEthRate = await feeBurner.kncPerETHRate();
//        log ("kncPerETHRate " + kncToEthRate.valueOf());

        let weiValue = new BigNumber(2 * 10 ** 18);
        let feeBps = await reserve.makersBurnFeeBps();

        let expectedBurn = weiValue.mul(kncToEthRate).mul(feeBps).div(1000);
//        log ("expected burn " + expectedBurn);

        let calcBurn = await reserve.calcBurnAmount(weiValue.valueOf());

        assert.equal(expectedBurn.valueOf(), calcBurn.valueOf());

        let kncStakePerWeiBps = await reserve.kncStakePerEtherBps();

        let calcExpectedStake = weiValue.mul(kncStakePerWeiBps).div(1000);
        let calcStake = await reserve.calcKncStake(weiValue);
//        log("stake val " + calcStake.valueOf());
        assert.equal(calcStake.valueOf(), calcExpectedStake.valueOf());

        assert(calcBurn < calcStake);
    });

    it("maker add buy order. user takes order. see taken order removed as expected.", async () => {
        let amountTwei = 5 * 10 ** 19; //500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, amountTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = 2 * 10 ** 18;
        let orderExchangeTwei = 9 * 10 ** 18;

        // add order
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});

        let list = await reserve.getBuyTokenOrderList();
        assert.equal(list.length, 1);

        //take order
//  function trade(ERC20 srcToken, uint srcAmount, ERC20 destToken, address destAddress, uint conversionRate, bool validate)

        rc = await reserve.trade(ethAddress, orderPayAmountWei, tokenAdd, user1, 300, false,
                        {value: orderPayAmountWei});
        log("take single order gas: " + rc.receipt.gasUsed);

        rate = await reserve.getConversionRate(ethAddress, token.address, 10 ** 18, 0);
        assert.equal(rate.valueOf(), 0);

        list = await reserve.getBuyTokenOrderList();
        assert.equal(list.length, 0);
    });

    it("maker add a few buy orders. user takes full orders. see user gets traded tokens. maker gets ether.", async () => {
        let amountTwei = 5 * 10 ** 19; //500 tokens
        let amountKnc = 2000 * 10 ** 18;

        await makerDeposit(maker1, 0, amountTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = new BigNumber(2 * 10 ** 18);
        let orderExchangeTwei = new BigNumber(9 * 10 ** 18);

        // add order
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});
        rc = await reserve.submitBuyTokenOrderWHint(orderPayAmountWei.add(1000), orderExchangeTwei, 0, {from: maker1});
        rc = await reserve.submitBuyTokenOrderWHint(orderPayAmountWei.add(2000), orderExchangeTwei, 0, {from: maker1});

        //take all orders
//  function trade(ERC20 srcToken, uint srcAmount, ERC20 destToken, address destAddress, uint conversionRate, bool validate)

        //maker eth balance before. (should be 0)
        let balance = await reserve.makerFunds(maker1, ethAddress);
        assert.equal(balance.valueOf(), 0);

        let totalOrderValue = orderPayAmountWei.mul(3).add(3000);
        let totalDestValue = orderExchangeTwei.mul(3);

        let userBalanceBefore = await token.balanceOf(user1);

        rc = await reserve.trade(ethAddress, totalOrderValue, tokenAdd, user1, 300, false,
                        {value: totalOrderValue});
        log("take 3 orders gas: " + rc.receipt.gasUsed);

        let userBalanceAfter = await token.balanceOf(user1);
        assert.equal(userBalanceAfter.valueOf(), totalDestValue.add(userBalanceBefore).valueOf());

        balance = await reserve.makerFunds(maker1, ethAddress);
        assert.equal(balance.valueOf(), totalOrderValue.valueOf());

        rate = await reserve.getConversionRate(ethAddress, token.address, 10 ** 18, 0);
        assert.equal(rate.valueOf(), 0);

        list = await reserve.getBuyTokenOrderList();
        assert.equal(list.length, 0);
    });

    it("maker add buy order. user takes partial. remaining order stays in book.", async () => {
        let amountTwei = new BigNumber(9 * 10 ** 18); //500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, amountTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = new BigNumber(2 * 10 ** 18);
        let orderExchangeTwei = amountTwei;

        // add order
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});

        let list = await reserve.getBuyTokenOrderList();
        assert.equal(list.length, 1);

        //take order
//  function trade(ERC20 srcToken, uint srcAmount, ERC20 destToken, address destAddress, uint conversionRate, bool validate)
        let takeAmount = orderPayAmountWei.div(2).sub(100);
        rc = await reserve.trade(ethAddress, takeAmount, tokenAdd, user1, 300, false,
                    {value: takeAmount});

        log("take partial order gas (rest not removed): " + rc.receipt.gasUsed);

        list = await reserve.getBuyTokenOrderList();
        assert.equal(list.length, 1);

        let balance = await reserve.makerFunds(maker1, ethAddress);
        assert.equal(balance.valueOf(), takeAmount.valueOf());

        balance = await reserve.makerFunds(maker1, tokenAdd);
        assert.equal(balance.valueOf(), 0);
    });

    it("maker add buy order. user takes partial. remaining order removed.", async () => {
        let amountTwei = new BigNumber(9 * 10 ** 18); //500 tokens
        let amountKnc = 600 * 10 ** 18;

        await makerDeposit(maker1, 0, amountTwei.valueOf(), amountKnc.valueOf());

        let orderPayAmountWei = new BigNumber(2 * 10 ** 18);
        let orderExchangeTwei = amountTwei;

        // add order
        let rc = await reserve.submitBuyTokenOrder(orderPayAmountWei, orderExchangeTwei, {from: maker1});

        let list = await reserve.getBuyTokenOrderList();
        assert.equal(list.length, 1);

        //take order
//  function trade(ERC20 srcToken, uint srcAmount, ERC20 destToken, address destAddress, uint conversionRate, bool validate)
        let takeAmount = orderPayAmountWei.div(2).add(300);
        rc = await reserve.trade(ethAddress, takeAmount, tokenAdd, user1, 300, false,
                        {value: takeAmount});

        log("take partial order gas (remaining removed): " + rc.receipt.gasUsed);

        list = await reserve.getBuyTokenOrderList();
        assert.equal(list.length, 0);

        let balance = await reserve.makerFunds(maker1, ethAddress);
        assert.equal(balance.valueOf(), takeAmount.valueOf());

        let expectedDestAmount = orderExchangeTwei.mul(takeAmount).div(orderPayAmountWei).floor();
        let expectedRemainingBalance = amountTwei.sub(expectedDestAmount);

        balance = await reserve.makerFunds(maker1, tokenAdd);
        assert.equal(balance.valueOf(), expectedRemainingBalance.valueOf());
    });

    it("maker add a few sell orders. user takes orders. see taken orders are removed as expected.", async () => {
        let orderSrcAmountTwei = new BigNumber(9 * 10 ** 18);
        let orderDstWei = new BigNumber(2 * 10 ** 18);

        let amountKnc = 600 * 10 ** 18;
        let amountEth = (new BigNumber(6 * 10 ** 18)).add(600);

        await makerDeposit(maker1, amountEth.valueOf(), 0, amountKnc.valueOf());

        // first getConversionRate should return 0
        let rate = await reserve.getConversionRate(token.address, ethAddress, 10 ** 18, 0);
        assert.equal(rate.valueOf(), 0);

        //now add order
        //////////////
//        makeOrder(address maker, bool isEthToToken, uint128 payAmount, uint128 exchangeAmount, uint32 hintPrevOrder)
        let rc = await reserve.submitSellTokenOrderWHint(orderSrcAmountTwei, orderDstWei, 0, {from: maker1});
        rc = await reserve.submitSellTokenOrderWHint(orderSrcAmountTwei, orderDstWei.add(400), 0, {from: maker1});
            rc = await reserve.submitSellTokenOrderWHint(orderSrcAmountTwei, orderDstWei.add(200), 0, {from: maker1});
//        log(rc.logs[0].args)

        let orderList = await reserve.getSellTokenOrderList();
        assert.equal(orderList.length, 3);
//        log(orderList);
        let srcRateAmount = new BigNumber(10 ** 18);
        rate = await reserve.getConversionRate(token.address, ethAddress, srcRateAmount, 0);
//        log("rate " + rate);

//        let dstRateAmount = srcRateAmount.mul(orderDstWei).div(orderSrcAmountTwei).floor();
        let expectedRate = precisionUnits.mul(orderDstWei).div(orderSrcAmountTwei).floor();
//        assert.equal(rate.valueOf(), expectedRate.valueOf());

        //tokens to user
        let totalPayValue = orderSrcAmountTwei.mul(3);
        await token.transfer(totalPayValue, user1);
        await token.approve(reserve.address, totalPayValue);

        let userInitialBalance = await await Helper.getBalancePromise(user1);
        //trade
        rc = await reserve.trade(tokenAdd, totalPayValue, ethAddress, user1, 300, false);
        log("take 3 sell orders gas: " + rc.receipt.gasUsed);

        orderList = await reserve.getSellTokenOrderList();
        assert.equal(orderList.length, 0);

        let userBalanceAfter = await Helper.getBalancePromise(user1);
        let expectedBalance = userInitialBalance.add(amountEth);

        assert.equal(userBalanceAfter.valueOf(), expectedBalance.valueOf());
    });

    xit("maker add a few sell orders. user takes orders. see user gets traded tokens. maker gets ether.", async () => {
    });

    xit("add max number of orders per maker 256 sell and 256 buy. see next order reverted.", async () => {
    });

    xit("add 200 buy orders. see gas price for add order with hint vs order without hint. end of list and start of list ", async () => {
    });

    xit("add 10 buy orders. see gas price for taking all orders as full on one trade.", async () => {
    });

    xit("add 10 buy orders. see gas price for taking all orders and last as partial on one trade.", async () => {
    });


});


contract('OrderBookReserve on network', async (accounts) => {

    beforeEach('setup contract for each test', async () => {

        if(init) {
            //below should happen once
            admin = accounts[0];
            user1 = accounts[1];
            user2 = accounts[2];
            maker1 = accounts[3];
            maker2 = accounts[4];
            let network = accounts[5];
            withDrawAddress = accounts[6];

            token = await TestToken.new("the token", "TOK", 18);
            tokenAdd = token.address;

            KNCToken = await TestToken.new("Kyber Crystals", "KNC", 18);
            kncAddress = KNCToken.address;

            feeBurner = await FeeBurner.new(admin, kncAddress, network);
            currentBlock = await Helper.getCurrentBlock();
            init = false;
        }

        reserve = await OrderBookReserve.new(feeBurner.address, kncAddress, tokenAdd, admin, 25);
    });
});

function log(str) {
    console.log(str);
}

async function makerDeposit(maker, ethWei, tokenTwei, kncTwei) {

    await token.approve(reserve.address, tokenTwei);
    await reserve.depositToken(maker, tokenTwei);
    await KNCToken.approve(reserve.address, kncTwei);
    await reserve.depositKncFee(maker, kncTwei);
    await reserve.depositEther(maker, {from: maker, value: ethWei});
}

async function twoStringsSoliditySha(str1, str2) {
    let str1Cut = str1.slice(2);
    let str2Cut = str2.slice(2);
    let combinedSTR = str1Cut + str2Cut;

    // Convert a string to a byte array
    for (var bytes = [], c = 0; c < combinedSTR.length; c += 2)
        bytes.push(parseInt(combinedSTR.substr(c, 2), 16));

    let sha3Res = await web3.sha3(bytes, {encoding: "hex"});

    return sha3Res;
};

function addBps (price, bps) {
    return (price.mul(10000 + bps).div(10000));
};

function compareRates (receivedRate, expectedRate) {
    expectedRate = expectedRate - (expectedRate % 10);
    receivedRate = receivedRate - (receivedRate % 10);
    assert.equal(expectedRate, receivedRate, "different prices");
};


function calcDstQty(srcQty, srcDecimals, dstDecimals, rate) {
    rate = new BigNumber(rate);
    if (dstDecimals >= srcDecimals) {
        let decimalDiff = (new BigNumber(10)).pow(dstDecimals - srcDecimals);
        return (rate.mul(srcQty).mul(decimalDiff).div(precisionUnits)).floor();
    } else {
        let decimalDiff = (new BigNumber(10)).pow(srcDecimals - dstDecimals);
        return (rate.mul(srcQty).div(decimalDiff.mul(precisionUnits))).floor();
    }
}