#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.n2.local"
PUBLISHABLE_KEY="sb_publishable__wDjWC4gaJcysTgiovn1gg_h_c7CY7Q"

if [[ -e "$ENV_FILE" ]]; then
  echo "Refusing to overwrite existing .env.n2.local. Keep your current credentials or remove the file explicitly first." >&2
  exit 1
fi

printf '%s\n' "KNOWVERSE staging N2 test setup"
printf '%s\n' "Project: knowverse-staging (ypthoicwrfsblaidllyy)"
printf '%s\n' "Enter each temporary password locally. Input will not be displayed."
printf '%s\n' "Use at least 16 characters from A-Z, a-z, 0-9, underscore or hyphen."

read -r -s -p "Temporary password for n2-sync-a: " PASSWORD_A
printf '\n'
read -r -s -p "Temporary password for n2-sync-b: " PASSWORD_B
printf '\n'

validate_password() {
  local label="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then
    echo "$label must be 16-128 characters using only letters, digits, underscore or hyphen." >&2
    exit 1
  fi
}
validate_password "Account A password" "$PASSWORD_A"
validate_password "Account B password" "$PASSWORD_B"
if [[ "$PASSWORD_A" == "$PASSWORD_B" ]]; then
  echo "Use different temporary passwords for accounts A and B." >&2
  exit 1
fi

umask 077
TEMP_FILE="$(mktemp "$ROOT/.env.n2.local.tmp.XXXXXX")"
cleanup() {
  rm -f "$TEMP_FILE"
  unset PASSWORD_A PASSWORD_B
}
trap cleanup EXIT

cat > "$TEMP_FILE" <<EOF
N2_SUPABASE_URL=https://ypthoicwrfsblaidllyy.supabase.co
N2_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY
N2_SYNC_A_EMAIL=n2-sync-a@knowverse-test.invalid
N2_SYNC_A_PASSWORD=$PASSWORD_A
N2_SYNC_B_EMAIL=n2-sync-b@knowverse-test.invalid
N2_SYNC_B_PASSWORD=$PASSWORD_B
EOF
chmod 600 "$TEMP_FILE"
mv "$TEMP_FILE" "$ENV_FILE"
unset PASSWORD_A PASSWORD_B
trap - EXIT

echo "Created .env.n2.local with file mode 600. It is ignored by Git."
echo "No password or JWT was printed. You can now run:"
echo "  set -a && source .env.n2.local && set +a"
echo "  node scripts/e2e-hosted-supabase-sync.mjs"
