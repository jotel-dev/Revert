// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Multicall3 mock supporting `aggregate3` for local Anvil E2E tests.
contract MockMulticall3 {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory returnData) {
        uint256 length = calls.length;
        returnData = new Result[](length);
        for (uint256 i = 0; i < length; ++i) {
            Call3 calldata callItem = calls[i];
            (bool success, bytes memory ret) = callItem.target.call(callItem.callData);
            if (!callItem.allowFailure && !success) {
                revert("Multicall3: call failed");
            }
            returnData[i] = Result(success, ret);
        }
    }
}
