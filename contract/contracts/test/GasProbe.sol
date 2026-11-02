// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.24;
interface IURI { function tokenURI(uint256) external view returns (string memory); }
/// Measures the gas of one tokenURI execution in a single eth_call (no estimateGas bisection).
contract GasProbe {
    function measure(address t, uint256 id) external view returns (uint256 g, uint256 len) {
        uint256 a = gasleft();
        string memory u = IURI(t).tokenURI(id);
        g = a - gasleft();
        len = bytes(u).length;
    }
}
