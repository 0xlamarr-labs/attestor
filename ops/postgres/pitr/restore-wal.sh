#!/bin/sh
set -eu

wal_file="$1"
destination="$2"
archive_dir="${ATTESTOR_PG_WAL_ARCHIVE_DIR:-/var/lib/postgresql/archive}"
source_file="${archive_dir}/${wal_file}"

if [ ! -f "$source_file" ]; then
  exit 1
fi

cp "$source_file" "$destination"
