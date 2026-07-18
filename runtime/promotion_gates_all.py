# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""Run the canonical L99 promotion gates plus portfolio cookie enforcement."""

from __future__ import annotations

from cookie_contract import verify_cookie_contract
import promotion_gates


def gate_cookie_contract() -> promotion_gates.GateResult:
    reasons = verify_cookie_contract(promotion_gates.ROOT)
    return (not reasons, reasons)


promotion_gates.GATES["cookie_contract"] = gate_cookie_contract


if __name__ == "__main__":
    raise SystemExit(promotion_gates.main())
