export const chromeCookieReaderScript = `
import base64
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
        columns = {row[1] for row in database.execute("PRAGMA table_info(cookies)")}
        required = {"host_key", "name", "path", "expires_utc", "is_secure", "is_httponly"}
        if not required.issubset(columns):
            raise RuntimeError("unsupported cookie database")

        version_row = database.execute("SELECT value FROM meta WHERE key = ?", ("version",)).fetchone()
        database_version = int(version_row[0]) if version_row else 0

        def field(name, fallback):
            return '"' + name + '"' if name in columns else fallback + " AS " + name

        selected = [
            field("host_key", "''"),
            field("name", "''"),
            field("value", "''"),
            field("encrypted_value", "X''"),
            field("path", "'/'"),
            "CAST(" + field("expires_utc", "0") + " AS TEXT) AS expires_utc_text",
            field("is_secure", "0"),
            field("is_httponly", "0"),
            field("samesite", "-1"),
            field("source_scheme", "0"),
            field("top_frame_site_key", "''"),
            field("has_expires", "1"),
        ]
        cookies = []
        for row in database.execute("SELECT " + ", ".join(selected) + " FROM cookies"):
            encrypted_value = row[3] or b""
            if isinstance(encrypted_value, str):
                encrypted_value = encrypted_value.encode("utf-8")
            cookies.append({
                "host": row[0],
                "name": row[1],
                "value": row[2],
                "encryptedValue": base64.b64encode(encrypted_value).decode("ascii"),
                "path": row[4],
                "expiresUtc": row[5],
                "isSecure": row[6],
                "isHttpOnly": row[7],
                "sameSite": row[8],
                "sourceScheme": row[9],
                "topFrameSiteKey": row[10],
                "hasExpires": row[11],
            })
        return {"databaseVersion": database_version, "cookies": cookies}
    finally:
        database.close()

try:
    source_path = sys.argv[1]
    with tempfile.TemporaryDirectory(prefix="sele-cookie-import-") as temporary_directory:
        snapshot_path = os.path.join(temporary_directory, "Cookies")
        shutil.copyfile(source_path, snapshot_path)
        if os.path.isfile(source_path + "-wal"):
            shutil.copyfile(source_path + "-wal", snapshot_path + "-wal")
        result = read_database(snapshot_path)
except Exception as error:
    result = {"error": str(error)}

print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
`.trim()
