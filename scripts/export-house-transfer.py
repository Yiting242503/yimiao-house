"""Read-only, consistent SQLite backups and private media copies for a house transfer."""
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys

TABLES = ('settings', 'markers', 'meetings', 'entries', 'media', 'comments', 'hearts', 'misses')


def connect_readonly(filename):
    connection = sqlite3.connect(filename.resolve().as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def rows(connection):
    return {table: [dict(row) for row in connection.execute(
        f'SELECT * FROM "{table}" ORDER BY ' + ('rowid' if table == 'media' else 'id'))]
        for table in TABLES}


def fingerprint(tables):
    return hashlib.sha256(json.dumps(tables, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()).hexdigest()


def main():
    project = Path(__file__).resolve().parents[1]
    destination = Path(sys.argv[1]).resolve()
    allowed = (project / '.standalone').resolve()
    if not destination.is_relative_to(allowed) or destination == allowed:
        raise RuntimeError('Backup must be a fresh directory within the ignored .standalone folder')
    d1_root = project / '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'
    r2_root = project / '.wrangler/state/v3/r2/miniflare-R2BucketObject'
    d1_candidates = [path for path in d1_root.glob('*.sqlite') if path.name != 'metadata.sqlite']
    r2_candidates = [path for path in r2_root.glob('*.sqlite') if path.name != 'metadata.sqlite']
    if len(d1_candidates) != 1 or len(r2_candidates) != 1:
        raise RuntimeError('Expected exactly one house D1 and R2 database')
    if len(sys.argv) > 2 and sys.argv[2] == '--check':
        saved = json.loads((destination / 'manifest.json').read_text(encoding='utf-8'))
        with connect_readonly(d1_candidates[0]) as live:
            if fingerprint(rows(live)) != saved['sourceFingerprint']:
                raise RuntimeError('Local content changed during the copy; export a fresh backup before committing')
        print(json.dumps({'unchanged': True}))
        return
    destination.mkdir(parents=True, exist_ok=False)
    for source, name in ((d1_candidates[0], 'house.sqlite'), (r2_candidates[0], 'media.sqlite')):
        with connect_readonly(source) as live, sqlite3.connect(destination / name) as backup:
            live.backup(backup)
    with connect_readonly(destination / 'house.sqlite') as house:
        tables = rows(house)
    with connect_readonly(destination / 'media.sqlite') as media:
        objects = {row['key']: dict(row) for row in media.execute('SELECT key,blob_id,size FROM _mf_objects')}
    target = destination / 'objects'
    target.mkdir()
    copied = []
    for file in tables['media']:
        item = objects.get(file['key'])
        if item is None:
            raise RuntimeError('A private media object is missing from the snapshot')
        blob_id = item['blob_id']
        if Path(blob_id).name != blob_id or Path(file['id']).name != file['id']:
            raise RuntimeError('Invalid private object identifier')
        source = project / '.wrangler/state/v3/r2/yimiao-local-media/blobs' / blob_id
        output = target / file['id']
        shutil.copyfile(source, output)
        if output.stat().st_size != item['size']:
            raise RuntimeError('Private media size changed during the backup')
        with output.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        copied.append({'id': file['id'], 'key': file['key'], 'type': file['type'], 'size': item['size'], 'sha256': digest, 'path': str(output)})
    manifest = {'version': 1, 'tables': tables, 'objects': copied, 'sourceFingerprint': fingerprint(tables)}
    (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    with connect_readonly(d1_candidates[0]) as live:
        if fingerprint(rows(live)) != manifest['sourceFingerprint']:
            raise RuntimeError('Local content changed during the backup; create a fresh export')
    print(json.dumps({'backup': str(destination), 'media': len(copied), 'bytes': sum(item['size'] for item in copied), 'entries': len(tables['entries']), 'trashed': sum(bool(file['deleted_at']) for file in tables['media']), 'sourceFingerprint': manifest['sourceFingerprint']}))


if __name__ == '__main__':
    main()
