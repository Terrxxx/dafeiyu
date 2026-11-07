"""只读核对 Windows 原始迁移数据"""
import hashlib
import json
from pathlib import Path

ROOT = Path("/opt/dafeiyu")
MANIFEST = ROOT / "backups/migration-20261027/source-manifest.json"


def _matches(entry: dict) -> bool:
    """核对单个文件或符号链接"""
    target = ROOT / entry['path']
    if 'link' in entry:
        return target.is_symlink() and str(target.readlink()) == entry['link']
    if not target.is_file() or target.stat().st_size != entry['size']:
        return False
    with target.open('rb') as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() == entry['sha256']


def VerifyMigration() -> tuple[int, dict]:
    """验证原始迁移清单

    :return: 状态码与统计, 0表示全部一致, 1表示存在差异"""
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))['entries']
    failed = sum(not _matches(entry) for entry in entries)
    result = {'checked': len(entries), 'matched': len(entries) - failed, 'mismatched': failed}
    (MANIFEST.parent / "verification.json").write_text(json.dumps(result), encoding="utf-8")
    return (1 if failed else 0), result


if __name__ == "__main__":
    STATUS, RESULT = VerifyMigration()
    print(json.dumps(RESULT))
    raise SystemExit(STATUS)
