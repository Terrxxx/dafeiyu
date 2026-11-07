"""Read-only verification of the original Windows deployment payload."""
import hashlib
import json
from pathlib import Path

root = Path('/opt/dafeiyu')
manifest = root / 'backups/migration-20261027/source-manifest.json'
entries = json.loads(manifest.read_text(encoding='utf-8'))['entries']
failed = []
for entry in entries:
    target = root / entry['path']
    if 'link' in entry:
        good = target.is_symlink() and str(target.readlink()) == entry['link']
    else:
        good = target.is_file() and target.stat().st_size == entry['size']
        if good:
            with target.open('rb') as stream:
                good = hashlib.file_digest(stream, 'sha256').hexdigest() == entry['sha256']
    if not good:
        failed.append(entry['path'])
result = {'checked': len(entries), 'matched': len(entries) - len(failed), 'mismatched': len(failed)}
(manifest.parent / 'verification.json').write_text(json.dumps(result), encoding='utf-8')
print(json.dumps(result))
if failed:
    raise SystemExit('Migration verification failed; do not start the agent.')
