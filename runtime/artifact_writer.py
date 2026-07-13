# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""L99 machine-readable artifact writer.

Events on the shared event bus reference an `artifact_ref` path (e.g.
`artifacts/2026-07-01/story_beat_042.json`).  This module owns the
write side: it validates the payload, serialises it to JSON (or raw
bytes for binary blobs), and writes it under the configured artifact
root directory.

Typical call-site (from a StoryEngine beat handler):

    from runtime.artifact_writer import ArtifactWriter

    writer = ArtifactWriter(root="/data/artifacts")
    ref = writer.write("story_beat", payload={"text": "…", "tags": []})
    # ref == "story_beat/2026-07-01T14-32-00Z_abc123.json"
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

DEFAULT_ARTIFACT_ROOT = os.environ.get("L99_ARTIFACT_ROOT", "/tmp/l99_artifacts")
_TS_FMT = "%Y-%m-%dT%H-%M-%SZ"


@dataclass
class WriteResult:
    """Returned by :meth:`ArtifactWriter.write`."""

    ref: str                  # relative path under artifact root
    abs_path: Path            # absolute filesystem path
    size_bytes: int
    sha256: str
    written_at: str           # ISO-8601 UTC


class ArtifactWriter:
    """Writes validated artifacts to the local filesystem.

    Parameters
    ----------
    root:
        Absolute path to the artifact root directory.  Created on first
        use if absent.
    pretty:
        If *True* (default) JSON artifacts are indented for readability.
    overwrite:
        Allow overwriting an existing file at the same path.  Defaults
        to *False* – a collision raises :class:`FileExistsError`.
    """

    def __init__(
        self,
        root: str | Path = DEFAULT_ARTIFACT_ROOT,
        *,
        pretty: bool = True,
        overwrite: bool = False,
    ) -> None:
        self._root = Path(root).expanduser().resolve()
        self._pretty = pretty
        self._overwrite = overwrite

    # ------------------------------------------------------------------
    # Public methods
    # ------------------------------------------------------------------

    def write(
        self,
        kind: str,
        payload: Any,
        *,
        date_prefix: str | None = None,
        suffix: str | None = None,
        raw: bool = False,
    ) -> WriteResult:
        """Persist *payload* as an artifact file.

        Parameters
        ----------
        kind:
            Logical artifact type, used as the subdirectory name and the
            filename prefix (e.g. ``"story_beat"``, ``"promotion_gate"``).
        payload:
            A JSON-serialisable object, or raw ``bytes`` when *raw=True*.
        date_prefix:
            Override the ``YYYY-MM-DD`` directory segment.  Defaults to
            today's UTC date.
        suffix:
            Optional string appended to the generated filename before the
            extension (e.g. a human-readable label).
        raw:
            When *True*, *payload* must be ``bytes`` and is written as-is
            (no JSON serialisation).  The file extension becomes ``.bin``.

        Returns
        -------
        WriteResult
        """
        _validate_kind(kind)
        ts = _utc_now()
        date_seg = date_prefix or ts[:10]          # "YYYY-MM-DD"
        ts_safe = datetime.utcnow().strftime(_TS_FMT)
        nonce = _short_nonce()
        name_parts = [kind, ts_safe, nonce]
        if suffix:
            name_parts.append(_slugify(suffix))
        ext = ".bin" if raw else ".json"
        filename = "_".join(name_parts) + ext

        rel_dir = Path(kind) / date_seg
        abs_dir = self._root / rel_dir
        abs_dir.mkdir(parents=True, exist_ok=True)

        abs_path = abs_dir / filename
        if abs_path.exists() and not self._overwrite:
            raise FileExistsError(f"Artifact already exists: {abs_path}")

        if raw:
            if not isinstance(payload, (bytes, bytearray)):
                raise TypeError(
                    f"raw=True requires bytes payload, got {type(payload).__name__}"
                )
            data_bytes: bytes = bytes(payload)
        else:
            data_bytes = _to_json_bytes(payload, pretty=self._pretty)

        abs_path.write_bytes(data_bytes)

        ref = str(rel_dir / filename)
        return WriteResult(
            ref=ref,
            abs_path=abs_path,
            size_bytes=len(data_bytes),
            sha256=hashlib.sha256(data_bytes).hexdigest(),
            written_at=ts,
        )

    def exists(self, ref: str) -> bool:
        """Return *True* if an artifact with *ref* is present on disk."""
        return (self._root / ref).exists()

    def read_json(self, ref: str) -> Any:
        """Load and return the JSON payload for *ref*."""
        path = self._root / ref
        if not path.exists():
            raise FileNotFoundError(f"Artifact not found: {ref}")
        return json.loads(path.read_bytes())

    def delete(self, ref: str) -> bool:
        """Delete the artifact at *ref*.  Returns *True* if deleted."""
        path = self._root / ref
        if path.exists():
            path.unlink()
            return True
        return False

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def root(self) -> Path:
        return self._root


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _validate_kind(kind: str) -> None:
    if not kind or not kind.replace("_", "").replace("-", "").isalnum():
        raise ValueError(
            f"Artifact kind must be alphanumeric (underscores/hyphens ok), got: {kind!r}"
        )


def _utc_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds")


def _short_nonce(length: int = 6) -> str:
    import secrets
    return secrets.token_hex(length // 2 + 1)[:length]


def _slugify(text: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40]


def _to_json_bytes(obj: Any, *, pretty: bool) -> bytes:
    indent = 2 if pretty else None
    return json.dumps(obj, indent=indent, ensure_ascii=False, default=str).encode()
