// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.24;
interface IBB { function bid() external payable; function withdrawReturn() external; }
/// A bidder whose wallet refuses ETH until told otherwise: exercises the refund fallback.
contract RefuseBidder {
    bool public accept;
    function bid(address bb) external payable { IBB(bb).bid{value: msg.value}(); }
    function setAccept(bool a) external { accept = a; }
    function pull(address bb) external { IBB(bb).withdrawReturn(); }
    receive() external payable { require(accept, "refused"); }
}
