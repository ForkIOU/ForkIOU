const hre = require('hardhat')
const chai = require('chai')

const {solidity} = require('ethereum-waffle')
const {assert, expect} = chai
const {BigNumber:BN} = hre.ethers

chai.use(solidity)
 
describe('ForkIOU', () => {
    const chainId = hre.network.config.chainId
    const provider = hre.ethers.provider
    console.log("chainid: ", chainId)
    let owner, alice, bob, carol
    let ForkIOU
    let EtherIOUToken, EthwIOUToken

    before('setup', async () => {
        // Set up users from hardhat signers
        [owner, alice, bob, carol] = await hre.ethers.getSigners()
    })

    it('deploys ForkIOU contract', async () => {
        // Deploy ForkIOU contract
        const ForkIOUFactory = await hre.ethers.getContractFactory('ForkIOUTestable')
        ForkIOU = await ForkIOUFactory.deploy()
        await ForkIOU.deployed()

        // Get IOU ERC20 tokens
        EtherIOUToken = await hre.ethers.getContractAt('IERC20', await ForkIOU.ethIOU())
        EthwIOUToken = await hre.ethers.getContractAt('IERC20', await ForkIOU.ethwIOU())
        console.log("ether IOU token: ", EtherIOUToken.address)
        console.log("ethw IOU token:  ", EthwIOUToken.address)
    })

    it('pauses the contract and disables IOU issuance', async () => {
        // Alice can't pause or unpause
        await expect(ForkIOU.connect(alice).pause()).to.be.revertedWith('Ownable: caller is not the owner')
        await expect(ForkIOU.connect(alice).unpause()).to.be.revertedWith('Ownable: caller is not the owner')

        // Pause and unpause should change state and disallow issuance
        await ForkIOU.connect(owner).pause()
        expect(await ForkIOU.isPaused()).to.be.eq(true)
        const etherAmountToDeposit = hre.ethers.utils.parseEther("10")
        await expect(ForkIOU.connect(alice).issueIOUs({value: etherAmountToDeposit})).to.be.revertedWith('SP')
        await expect(ForkIOU.connect(bob).issueIOUs({value: etherAmountToDeposit})).to.be.revertedWith('SP')
        await ForkIOU.connect(owner).unpause()
        expect(await ForkIOU.isPaused()).to.be.eq(false)
    })

    it('tries to deposit with zero ether', async () => {
        const etherAmountToDeposit = hre.ethers.utils.parseEther("0")
        await expect(ForkIOU.connect(alice).issueIOUs({value: etherAmountToDeposit})).to.be.revertedWith('NZE')
    })

    it('deposits eth and gets equivalent IOU ERC20 tokens', async () => {
        const etherAmountToDeposit = hre.ethers.utils.parseEther("10")

        // Get alice balance before calling issueIOUs()
        const aliceEtherBalanceBefore = await provider.getBalance(alice.address)
        const aliceEtherIOUBalanceBefore = await EtherIOUToken.balanceOf(alice.address)
        const aliceEthwIOUBalanceBefore = await EthwIOUToken.balanceOf(alice.address)

        // Simulate alice calling issueIOUs() on ForkIOU contract to issue IOUs
        const totalEthVolumeBefore = await ForkIOU.totalEthVolume()
        const issueIOUsCallTransaction = await ForkIOU.connect(alice).issueIOUs({value: etherAmountToDeposit})
        const issueIOUsCallTransactionReceipt = await issueIOUsCallTransaction.wait()
        const totalEthVolumeAfter = await ForkIOU.totalEthVolume()

        // Get exact gas cost of calling issueIOUs()
        const issueIOUsCallTransactionGasUsed = issueIOUsCallTransactionReceipt.cumulativeGasUsed
        const issueIOUsCallTransactionGasPrice = issueIOUsCallTransactionReceipt.effectiveGasPrice
        const issueIOUsCallTransactionGasCost = issueIOUsCallTransactionGasUsed.mul(issueIOUsCallTransactionGasPrice)
        
        // Get alice balance after calling issueIOUs()
        const aliceEtherBalanceAfter = await provider.getBalance(alice.address)
        const aliceEtherIOUBalanceAfter = await EtherIOUToken.balanceOf(alice.address)
        const aliceEthwIOUBalanceAfter = await EthwIOUToken.balanceOf(alice.address)

        // Get delta by comparing before and after balances taking into account gas
        const aliceEtherIOUBalanceDelta = aliceEtherIOUBalanceAfter.sub(aliceEtherIOUBalanceBefore)
        const aliceEthwIOUBalanceDelta = aliceEthwIOUBalanceAfter.sub(aliceEthwIOUBalanceBefore)
        const totalEthVolumeDelta = totalEthVolumeAfter.sub(totalEthVolumeBefore)

        // Assert balances and deltas are correct
        // 1. alice's ether balance should now be their balance before minus the amount deposited and contract call gas cost
        expect(aliceEtherBalanceAfter).to.be.eq(aliceEtherBalanceBefore.sub(etherAmountToDeposit).sub(issueIOUsCallTransactionGasCost))

        // 2. alice's etherIOU balance after should be equal to the amount deposited
        expect(aliceEtherIOUBalanceDelta).to.be.eq(etherAmountToDeposit)

        // 3. alice's ethwIOU balance after should be equal to the amount deposited and the alice's etherIOU balance
        expect(aliceEthwIOUBalanceDelta).to.be.eq(etherAmountToDeposit)
        expect(aliceEthwIOUBalanceDelta).to.be.eq(aliceEtherIOUBalanceDelta)

        // 4. eth volume delta should be equal to the amount deposited
        expect(totalEthVolumeDelta).to.be.eq(etherAmountToDeposit)
    })

    it('tries to withdraw ethw before merge on mainnet', async () => {
        // Revert with 'is eth mainnet'
        await expect(ForkIOU.connect(alice).redeemEthw()).to.be.revertedWith('IEM')
    })

    it('tries to withdraw ether before merge on mainnet', async () => {
        // Revert with 'not after merge'
        await expect(ForkIOU.connect(alice).redeemEth()).to.be.revertedWith('NAM')
    })

    it('simulates the merge', async () => {
        await ForkIOU.activateMainnetMerge()
        expect(await ForkIOU.getBlockDifficulty()).to.be.eq(BN.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'))
    })

    it('withdraws ether after merge', async () => {
        // Get balances before calling redeemEth() and attempt to call redeemEth()
        const aliceEtherBalanceBefore = await provider.getBalance(alice.address)
        const aliceEtherIOUBalanceBefore = await EtherIOUToken.balanceOf(alice.address)
        const redeemEthTransaction = await ForkIOU.connect(alice).redeemEth()
        const redeemEthTransactionReceipt = await redeemEthTransaction.wait()

        // Get exact gas cost of calling redeemEth()
        const redeemEthTransactionGasUsed = redeemEthTransactionReceipt.cumulativeGasUsed
        const redeemEthTransactionGasPrice = redeemEthTransactionReceipt.effectiveGasPrice
        const redeemEthTransactionGasCost = redeemEthTransactionGasUsed.mul(redeemEthTransactionGasPrice)

        // Ensure balances after match expected values considering gas cost
        const aliceEtherBalanceAfter = await provider.getBalance(alice.address)
        const aliceEtherIOUBalanceAfter = await EtherIOUToken.balanceOf(alice.address)

        // 1. alice's ether balance should now be their balance before plus the amount of IOU tokens minus contract call gas cost
        expect(aliceEtherBalanceAfter).to.be.eq(aliceEtherBalanceBefore.add(aliceEtherIOUBalanceBefore).sub(redeemEthTransactionGasCost))

        // 2. alice's IOU balance should now be zero
        expect(aliceEtherIOUBalanceAfter).to.be.eq(BN.from('0'))
    })

    it('tries to withdraw ether without IOU tokens', async () => {
        // Revert with 'no zero balance'
        await expect(ForkIOU.connect(alice).redeemEth()).to.be.revertedWith('NZB')
        await expect(ForkIOU.connect(bob).redeemEth()).to.be.revertedWith('NZB')
    })

    it('tries to withdraw ethw after merge on mainnet', async () => {
        // Revert with 'is eth mainnet'
        await expect(ForkIOU.connect(alice).redeemEthw()).to.be.revertedWith('IEM')
    })

    it('simulates the fork', async () => {
        await ForkIOU.switchToPowChain()
        expect(await ForkIOU.getChainId()).to.be.eq(BN.from('10001'))

        // Send ether to the contract to simulate ethw
        const amountEtherToSimulate = await ForkIOU.totalEthVolume()
        await provider.send("hardhat_setBalance", [ForkIOU.address, amountEtherToSimulate.toHexString()])

    })

    it('tries to withdraw ether from pow fork', async () => {
        // Revert with 'not ethereum mainnet'
        await expect(ForkIOU.connect(alice).redeemEth()).to.be.revertedWith('NEM')
        await expect(ForkIOU.connect(bob).redeemEth()).to.be.revertedWith('NEM')
    })

    it('withdraws ethw from pow fork', async () => {
        // Get balances before calling redeemEth() and attempt to call redeemEth()
        const aliceEthwBalanceBefore = await provider.getBalance(alice.address)
        const aliceEthwIOUBalanceBefore = await EthwIOUToken.balanceOf(alice.address)
        const aliceIncurredEthwFee = aliceEthwIOUBalanceBefore.mul(await ForkIOU.fee()).div(BN.from('10000'))
        const redeemEthwTransaction = await ForkIOU.connect(alice).redeemEthw()
        const redeemEthwTransactionReceipt = await redeemEthwTransaction.wait()

        // Get exact gas cost of calling redeemEth()
        const redeemEthwTransactionGasUsed = redeemEthwTransactionReceipt.cumulativeGasUsed
        const redeemEthwTransactionGasPrice = redeemEthwTransactionReceipt.effectiveGasPrice
        const redeemEthwTransactionGasCost = redeemEthwTransactionGasUsed.mul(redeemEthwTransactionGasPrice)

        // Ensure balances after match expected values considering gas cost
        const aliceEthwBalanceAfter = await provider.getBalance(alice.address)
        const aliceEthwIOUBalanceAfter = await EthwIOUToken.balanceOf(alice.address)

        // 1. alice's ethw balance should now be their balance before plus the amount of IOU tokens minus contract call gas cost
        expect(aliceEthwBalanceAfter).to.be.eq(aliceEthwBalanceBefore.add(aliceEthwIOUBalanceBefore).sub(redeemEthwTransactionGasCost).sub(aliceIncurredEthwFee))

        // 2. alice's IOU balance should now be zero
        expect(aliceEthwIOUBalanceAfter).to.be.eq(BN.from('0'))
    })
})
