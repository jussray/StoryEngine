# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""Run canonical L99 promotion, cookie-auth, Control Room, and prose-quality gates."""

from __future__ import annotations

from control_room_contract import verify_control_room_contract
from cookie_contract import verify_cookie_contract
from quality_gate_extended import verify_prose_quality_contract
import promotion_gates


def gate_cookie_contract() -> promotion_gates.GateResult:
    reasons = verify_cookie_contract(promotion_gates.ROOT)
    return (not reasons, reasons)


def gate_control_room_federation() -> promotion_gates.GateResult:
    reasons = verify_control_room_contract(promotion_gates.ROOT)
    return (not reasons, reasons)


def gate_prose_quality_contract() -> promotion_gates.GateResult:
    reasons = verify_prose_quality_contract(promotion_gates.ROOT)
    return (not reasons, reasons)


promotion_gates.GATES["cookie_contract"] = gate_cookie_contract
promotion_gates.GATES["control_room_federation"] = gate_control_room_federation
promotion_gates.GATES["prose_quality_contract"] = gate_prose_quality_contract


if __name__ == "__main__":
    raise SystemExit(promotion_gates.main())
