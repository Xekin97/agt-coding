#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: validate-profile.sh profiles/<profile-id>/PROFILE.yaml" >&2
  exit 2
fi

profile_file="$1"
validator_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$validator_dir/.." && pwd)"

if [[ ! -f "$profile_file" ]]; then
  echo "profile file not found: $profile_file" >&2
  exit 1
fi

ruby - "$profile_file" "$repo_root" <<'RUBY'
require "yaml"
require "pathname"

profile_file = File.expand_path(ARGV.fetch(0))
repo_root = Pathname.new(ARGV.fetch(1)).expand_path
errors = []

begin
  profile = YAML.safe_load(File.read(profile_file), permitted_classes: [], aliases: false)
rescue StandardError => e
  warn "invalid YAML: #{e.message}"
  exit 1
end

unless profile.is_a?(Hash)
  warn "profile root must be a mapping"
  exit 1
end

require_string = lambda do |mapping, key, context|
  value = mapping[key]
  errors << "#{context}.#{key} must be a non-empty string" unless value.is_a?(String) && !value.empty?
  value
end

require_non_empty_array = lambda do |mapping, key, context|
  value = mapping[key]
  errors << "#{context}.#{key} must be a non-empty array" unless value.is_a?(Array) && !value.empty?
  value.is_a?(Array) ? value : []
end

relative_repo_file = lambda do |value, context|
  unless value.is_a?(String) && !value.empty?
    errors << "#{context} must be a non-empty repository-relative path"
    next
  end

  path = Pathname.new(value)
  if path.absolute? || path.each_filename.include?("..")
    errors << "#{context} must stay within the agt-coding repository: #{value}"
    next
  end

  errors << "#{context} does not exist: #{value}" unless (repo_root + path).file?
end

errors << "schema_version must equal 1" unless profile["schema_version"] == 1

profile_id = require_string.call(profile, "id", "profile")
profile_version = require_string.call(profile, "version", "profile")
status = require_string.call(profile, "status", "profile")
require_string.call(profile, "name", "profile")
require_string.call(profile, "summary", "profile")

if profile_id && profile_id !~ /\A[a-z][a-z0-9]*(?:-[a-z0-9]+)*\z/
  errors << "profile.id must use lowercase kebab-case"
end
if profile_version && profile_version !~ /\A\d+\.\d+\.\d+\z/
  errors << "profile.version must use MAJOR.MINOR.PATCH"
end
unless %w[available draft deprecated].include?(status)
  errors << "profile.status must be available, draft, or deprecated"
end

directory_id = File.basename(File.dirname(profile_file))
if profile_id && directory_id != profile_id
  errors << "profile directory '#{directory_id}' must match id '#{profile_id}'"
end
errors << "profile file must be named PROFILE.yaml" unless File.basename(profile_file) == "PROFILE.yaml"

recommendation = profile["recommendation"]
if recommendation.is_a?(Hash)
  %w[fit mismatch defaults tradeoffs].each do |key|
    require_non_empty_array.call(recommendation, key, "recommendation")
  end
else
  errors << "recommendation must be a mapping"
end

decision_policy = profile["decision_policy"]
if decision_policy.is_a?(Hash)
  unless decision_policy["profile_defaults_status"] == "PROPOSED"
    errors << "decision_policy.profile_defaults_status must equal PROPOSED"
  end
  require_non_empty_array.call(decision_policy, "user_confirmation_required_for", "decision_policy")
  require_string.call(decision_policy, "rule", "decision_policy")
else
  errors << "decision_policy must be a mapping"
end

roles = require_non_empty_array.call(profile, "roles", "profile")
role_ids = []
specialist_ids = []
control_ids = []
allowed_prefixes = %w[bootstrap gatekeeper product designer dba backend frontend qa]

roles.each_with_index do |role, index|
  context = "roles[#{index}]"
  unless role.is_a?(Hash)
    errors << "#{context} must be a mapping"
    next
  end

  role_id = require_string.call(role, "id", context)
  kind = require_string.call(role, "kind", context)
  prefix = require_string.call(role, "display_name_prefix", context)
  sources = require_non_empty_array.call(role, "sources", context)
  skill = require_string.call(role, "skill", context)

  if role_id
    errors << "duplicate role id: #{role_id}" if role_ids.include?(role_id)
    role_ids << role_id
  end
  if kind == "specialist"
    specialist_ids << role_id if role_id
  elsif kind == "control"
    control_ids << role_id if role_id
  else
    errors << "#{context}.kind must be specialist or control"
  end
  errors << "#{context}.display_name_prefix is not supported: #{prefix}" if prefix && !allowed_prefixes.include?(prefix)
  sources.each_with_index { |source, source_index| relative_repo_file.call(source, "#{context}.sources[#{source_index}]") }
  relative_repo_file.call(skill, "#{context}.skill") if skill
end

workflow = profile["workflow"]
unless workflow.is_a?(Hash)
  errors << "workflow must be a mapping"
  workflow = {}
end

initial_stage = require_string.call(workflow, "initial_stage", "workflow")
terminal_stage = require_string.call(workflow, "terminal_stage", "workflow")
control_role = require_string.call(workflow, "control_role", "workflow")
stages = require_non_empty_array.call(workflow, "stages", "workflow")
errors << "workflow.control_role must reference a control role" if control_role && !control_ids.include?(control_role)

stage_ids = stages.filter_map { |stage| stage["id"] if stage.is_a?(Hash) }
errors << "workflow.initial_stage does not exist: #{initial_stage}" if initial_stage && !stage_ids.include?(initial_stage)
errors << "workflow.terminal_stage does not exist: #{terminal_stage}" if terminal_stage && !stage_ids.include?(terminal_stage)
errors << "workflow stage ids must be unique" unless stage_ids.uniq.length == stage_ids.length

referenced_specialists = []
if workflow.key?("workstreams")
  streams = workflow["workstreams"]
  unless streams.is_a?(Hash) && streams["supported"] == true && streams["opt_in"] == true && streams["artifact_root"] == ".planning/milestones/{milestone}/workstreams/{workstream}"
    errors << "workflow.workstreams must explicitly declare supported, opt_in and the scoped artifact_root"
  end
end
artifact_paths = []
stages.each_with_index do |stage, index|
  context = "workflow.stages[#{index}]"
  unless stage.is_a?(Hash)
    errors << "#{context} must be a mapping"
    next
  end

  stage_id = require_string.call(stage, "id", context)
  policy = require_string.call(stage, "completion_policy", context)
  allowed_roles = stage["allowed_roles"]
  required_artifacts = stage["required_artifacts"]
  transitions = stage["transitions"]

  errors << "#{context}.allowed_roles must be an array" unless allowed_roles.is_a?(Array)
  errors << "#{context}.required_artifacts must be an array" unless required_artifacts.is_a?(Array)
  errors << "#{context}.transitions must be an array" unless transitions.is_a?(Array)
  errors << "#{context}.user_approval_required must be true or false" unless [true, false].include?(stage["user_approval_required"])
  errors << "#{context}.completion_policy is unsupported: #{policy}" unless %w[single-role all-roles terminal].include?(policy)

  allowed_roles = [] unless allowed_roles.is_a?(Array)
  required_artifacts = [] unless required_artifacts.is_a?(Array)
  transitions = [] unless transitions.is_a?(Array)

  if policy == "terminal"
    errors << "#{context} terminal stage cannot allow specialist roles" unless allowed_roles.empty?
  elsif allowed_roles.empty?
    errors << "#{context} must allow at least one specialist role"
  end

  allowed_roles.each do |role_id|
    errors << "#{context} references unknown specialist role: #{role_id}" unless specialist_ids.include?(role_id)
    referenced_specialists << role_id
  end

  if stage.key?("role_sequence")
    sequence = stage["role_sequence"]
    if !sequence.is_a?(Array) || sequence != allowed_roles
      errors << "#{context}.role_sequence must list allowed_roles in execution order"
    end
  end

  required_artifacts.each_with_index do |artifact, artifact_index|
    artifact_context = "#{context}.required_artifacts[#{artifact_index}]"
    unless artifact.is_a?(String) && artifact.start_with?(".planning/") && !Pathname.new(artifact).each_filename.include?("..")
      errors << "#{artifact_context} must be a safe .planning/ path"
      next
    end
    errors << "duplicate required artifact: #{artifact}" if artifact_paths.include?(artifact)
    artifact_paths << artifact
  end

  transitions.each do |target|
    errors << "#{context} transition target does not exist: #{target}" unless stage_ids.include?(target)
    errors << "#{context} cannot transition to itself" if target == stage_id
  end
end

missing_specialists = specialist_ids - referenced_specialists
errors << "specialist roles not assigned to a stage: #{missing_specialists.join(', ')}" unless missing_specialists.empty?

ai_delivery_contract = profile["ai_delivery_contract"]
unless ai_delivery_contract.is_a?(Hash)
  errors << "ai_delivery_contract must be a mapping"
else
  require_string.call(ai_delivery_contract, "applies_when", "ai_delivery_contract")
  ai_delivery_contract.each do |section_name, section|
    next unless section_name.end_with?("_requirements")

    context = "ai_delivery_contract.#{section_name}"
    unless section.is_a?(Hash)
      errors << "#{context} must be a mapping"
      next
    end

    owner_role = require_string.call(section, "owner_role", context)
    errors << "#{context}.owner_role must reference a specialist role" if owner_role && !specialist_ids.include?(owner_role)
    require_non_empty_array.call(section, "required_topics", context)
  end
end
unless profile["delivery_defaults"].is_a?(Hash) && !profile["delivery_defaults"].empty?
  errors << "delivery_defaults must be a non-empty mapping"
end

if errors.any?
  errors.each { |error| warn "- #{error}" }
  warn "invalid profile: #{profile_file}"
  exit 1
end

puts "valid profile: #{profile_id}@#{profile_version} (#{status})"
RUBY
