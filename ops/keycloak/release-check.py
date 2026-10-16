#!/usr/bin/env python3
"""ChildBEx Keycloak stable release checks for existing Node Exporter textfile."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Verify this release path on ChildBEx before installation (do not assume).
ROOT = Path("/opt/keycloak")
RELEASES = ROOT / "releases"
CURRENT = ROOT / "current"
OUT = Path("/var/lib/node_exporter/textfile_collector/childbex_keycloak_release.prom")
RELEASES_URL = "https://api.github.com/repos/keycloak/keycloak/releases?per_page=50"
# Upstream release descriptions/assets make the complete 50-item JSON exceed 1 MB.
# Keep a bounded payload while retaining coverage of the latest stable releases.
MAX_RESPONSE_BYTES = 8_000_000
DEPLOYMENT = "childbex"
VERSION = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


def parse_version(s):
    match = VERSION.fullmatch(s)
    if not match:
        raise ValueError("Expected stable numeric Keycloak version")
    return tuple(int(n) for n in match.groups())


def installed_version():
    target = CURRENT.resolve(strict=True)
    if target.parent != RELEASES or not (target / "bin/kc.sh").is_file():
        raise ValueError("Unexpected Keycloak current symlink target")
    parse_version(target.name)
    return target.name


def newest_stable(releases):
    valid = []
    if not isinstance(releases, list):
        raise ValueError("Unexpected Keycloak releases response shape")
    for item in releases:
        if not isinstance(item, dict):
            continue
        if item.get("draft") or item.get("prerelease"):
            continue
        tag = item.get("tag_name", "")
        if not isinstance(tag, str) or not VERSION.fullmatch(tag):
            continue
        valid.append((parse_version(tag), tag.lstrip("v")))
    if not valid:
        raise ValueError("No stable numeric Keycloak release in GitHub response")
    return max(valid)[1]


def read_releases(response):
    raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("Keycloak releases response exceeds allowed size")
    return newest_stable(json.loads(raw))


def fetch_latest():
    request = Request(
        RELEASES_URL,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "shared-infrastructure-keycloak-release-monitor",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urlopen(request, timeout=15) as response:
        return read_releases(response)


def write_metrics(metrics):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", prefix=".keycloak-release.",
            suffix=".tmp", dir=OUT.parent, delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write(metrics)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(0o644)
        os.replace(temporary, OUT)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def metrics(installed, latest, error=False):
    now = int(time.time())
    output = [
        "# HELP keycloak_release_check_success 1 if the most recent release check succeeded.",
        "# TYPE keycloak_release_check_success gauge",
        f'keycloak_release_check_success{{deployment="{DEPLOYMENT}"}} {0 if error else 1}',
        "# HELP keycloak_release_check_timestamp_seconds Unix time of most recent check attempt.",
        "# TYPE keycloak_release_check_timestamp_seconds gauge",
        f'keycloak_release_check_timestamp_seconds{{deployment="{DEPLOYMENT}"}} {now}',
    ]
    if not error:
        output += [
            "# HELP keycloak_release_update_available 1 when newer stable Keycloak release exists.",
            "# TYPE keycloak_release_update_available gauge",
            ('keycloak_release_update_available{deployment="%s",installed_version="%s",'
             'latest_version="%s"} %d') % (
                DEPLOYMENT, installed, latest,
                int(parse_version(latest) > parse_version(installed))
            ),
        ]
    return "\n".join(output) + "\n"


def self_test():
    from io import BytesIO

    assert parse_version("v26.8.1") == (26, 8, 1)
    assert parse_version("26.10.0") > parse_version("26.9.99")
    assert newest_stable([
        {"tag_name": "27.0.0-rc1", "draft": False, "prerelease": True},
        {"tag_name": "26.8.2", "draft": False, "prerelease": False},
        {"tag_name": "26.7.13", "draft": False, "prerelease": False},
        {"tag_name": "99.1.0", "draft": True, "prerelease": False},
    ]) == "26.8.2"
    assert newest_stable([
        {"tag_name": "v26.9.0", "prerelease": False},
        {"tag_name": "26.8.99", "prerelease": False},
    ]) == "26.9.0"
    # Regression: upstream release JSON legitimately exceeds the old 1 MB cap.
    big_response = json.dumps([{
        "tag_name": "26.8.2",
        "draft": False,
        "prerelease": False,
        "body": "x" * 1_050_000,
    }]).encode("utf-8")
    assert read_releases(BytesIO(big_response)) == "26.8.2"
    try:
        read_releases(BytesIO(b"x" * (MAX_RESPONSE_BYTES + 1)))
    except ValueError as exc:
        assert str(exc) == "Keycloak releases response exceeds allowed size"
    else:
        raise AssertionError("Overlarge response unexpectedly accepted")
    assert 'deployment="childbex"' in metrics("26.7.3", "26.8.1")
    assert 'latest_version="26.8.1"} 1' in metrics("26.7.3", "26.8.1")
    assert "keycloak_release_update_available" not in metrics(None, None, error=True)
    print("ChildBEx Keycloak release checker self-test: PASS")


def main():
    os.umask(0o077)
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return 0
    if len(sys.argv) != 1:
        print("Usage: keycloak-release-check [--self-test]", file=sys.stderr)
        return 2
    try:
        current = installed_version()
        latest = fetch_latest()
        output = metrics(current, latest)
    except (OSError, ValueError, URLError, HTTPError, json.JSONDecodeError) as exc:
        # Report failure without leaving a stale previous update-available gauge.
        # Avoid logging HTTP bodies or any user secrets.
        print("ChildBEx Keycloak release check failed: " + type(exc).__name__, file=sys.stderr)
        write_metrics(metrics(None, None, error=True))
        return 1

    write_metrics(output)
    print(f"ChildBEx Keycloak stable release check: installed={current} latest={latest} "
          f"update_available={int(parse_version(latest) > parse_version(current))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
