#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: validate-agent-name.sh <role-person-name>" >&2
  exit 2
fi

agent_name="$1"
name_pattern='^(bootstrap|gatekeeper|product|designer|dba|backend|frontend|qa)-[a-z]{2,16}$'

if [[ ! "$agent_name" =~ $name_pattern ]]; then
  echo "invalid agent name: $agent_name" >&2
  echo "expected <role-prefix>-<person-name>, for example designer-tony or frontend-bob" >&2
  exit 1
fi

person_name="${agent_name#*-}"

if [[ "$person_name" =~ ^[a-f]{6,16}$ ]]; then
  echo "invalid agent name: suffix looks like a hexadecimal hash" >&2
  exit 1
fi

case "$person_name" in
  agent|default|random|temp|test|unknown|worker)
    echo "invalid agent name: suffix must be a human-readable person name" >&2
    exit 1
    ;;
esac

echo "valid agent name: $agent_name"
