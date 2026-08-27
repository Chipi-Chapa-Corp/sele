export const firefoxCookieReaderScript = `
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import urllib.parse

def read_database(path):
    uri = "file:" + urllib.parse.quote(path, safe="/:\\\\") + "?mode=ro"
    database = sqlite3.connect(uri, uri=True, timeout=5)
    try:
        database.execute("PRAGMA query_only = ON")
        schema_version = int(database.execute("PRAGMA user_version").fetchone()[0])
        columns = {row[1] for row in database.execute("PRAGMA table_info(moz_cookies)")}
        required = {"name", "value", "host", "path", "expiry", "isSecure", "isHttpOnly"}
        if not required.issubset(columns):
            raise RuntimeError("unsupported cookie database")

        def field(name, fallback):
            return '"' + name + '"' if name in columns else fallback + " AS " + name

        selected = [
            field("name", "''"),
            field("value", "''"),
            field("host", "''"),
            field("path", "'/'"),
            field("expiry", "0"),
            field("isSecure", "0"),
            field("isHttpOnly", "0"),
            field("sameSite", "256"),
            field("originAttributes", "''"),
            field("schemeMap", "0"),
            field("isPartitionedAttributeSet", "0"),
        ]
        names = [
            "name", "value", "host", "path", "expiry", "isSecure", "isHttpOnly",
            "sameSite", "originAttributes", "schemeMap", "isPartitionedAttributeSet"
        ]
        cookies = [dict(zip(names, row)) for row in database.execute("SELECT " + ", ".join(selected) + " FROM moz_cookies")]
        return {"schemaVersion": schema_version, "cookies": cookies}
    finally:
        database.close()

try:
    source_path = sys.argv[1]
    with tempfile.TemporaryDirectory(prefix="sele-cookie-import-") as temporary_directory:
        snapshot_path = os.path.join(temporary_directory, "cookies.sqlite")
        shutil.copyfile(source_path, snapshot_path)
        if os.path.isfile(source_path + "-wal"):
            shutil.copyfile(source_path + "-wal", snapshot_path + "-wal")
        result = read_database(snapshot_path)
except Exception as error:
    result = {"error": str(error)}

print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
`.trim()
