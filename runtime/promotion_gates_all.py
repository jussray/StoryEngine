# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""Run canonical L99 promotion, cookie-auth, Control Room, and prose-quality gates."""

from __future__ import annotations

from control_room_contract import verify_control_room_contract
from cookie_contract import verify_cookie_contract
from quality_gate_extended import verify_prose_quality_contract
import promotion_gates


_base_lindymode_drift_gate = promotion_gates.GATES["lindymode_drift"]


def gate_cookie_contract() -> promotion_gates.GateResult:
    reasons = verify_cookie_contract(promotion_gates.ROOT)
    return (not reasons, reasons)


def gate_control_room_federation() -> promotion_gates.GateResult:
    reasons = verify_control_room_contract(promotion_gates.ROOT)
    return (not reasons, reasons)


def gate_lindymode_drift_with_prose_quality() -> promotion_gates.GateResult:
    passed, reasons = _base_lindymode_drift_gate()
    prose_reasons = verify_prose_quality_contract(promotion_gates.ROOT)
    combined = [*reasons, *prose_reasons]
    return (passed and not prose_reasons, combined)


promotion_gates.GATES["lindymode_drift"] = gate_lindymode_drift_with_prose_quality
promotion_gates.GATES["cookie_contract"] = gate_cookie_contract
promotion_gates.GATES["control_room_federation"] = gate_control_room_federation


if __name__ == "__main__":
    raise SystemExit(promotion_gates.main())
