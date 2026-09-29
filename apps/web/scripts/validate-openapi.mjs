const url = process.env.EVALBOARD_OPENAPI_URL ?? 'http://127.0.0.1:8010/openapi.json'

const endpoints = [
  ['get', '/api/v1/health'],
  ['post', '/api/v1/auth/login'], ['get', '/api/v1/auth/me'], ['post', '/api/v1/auth/logout'],
  ['get', '/api/v1/datasets'], ['post', '/api/v1/datasets/import'],
  ['get', '/api/v1/datasets/{dataset_id}/versions/{version_id}/cases'],
  ['post', '/api/v1/datasets/{dataset_id}/versions/{version_id}/cases/{case_id}/edit'],
  ['get', '/api/v1/targets'], ['post', '/api/v1/targets'],
  ['get', '/api/v1/configs'], ['post', '/api/v1/configs'],
  ['get', '/api/v1/gates'], ['post', '/api/v1/gates'],
  ['get', '/api/v1/experiments'], ['post', '/api/v1/experiments'],
  ['get', '/api/v1/experiments/{experiment_id}'],
  ['post', '/api/v1/experiments/{experiment_id}/pause'],
  ['post', '/api/v1/experiments/{experiment_id}/resume'],
  ['post', '/api/v1/experiments/{experiment_id}/cancel'],
  ['get', '/api/v1/experiments/{experiment_id}/results'],
  ['get', '/api/v1/experiments/{experiment_id}/comparison'],
  ['get', '/api/v1/experiments/{experiment_id}/events/history'],
  ['get', '/api/v1/experiments/{experiment_id}/events'],
  ['get', '/api/v1/reviews'], ['post', '/api/v1/reviews/{review_id}/decision'],
  ['post', '/api/v1/reviews/{review_id}/adjudicate'],
  ['get', '/api/v1/experiments/{experiment_id}/report'],
  ['get', '/api/v1/experiments/{experiment_id}/report/export'],
]

const requiredBodies = [
  ['/api/v1/datasets/import', 'DatasetImport', ['name', 'jsonl']],
  ['/api/v1/datasets/{dataset_id}/versions/{version_id}/cases/{case_id}/edit', 'CaseEdit', ['case']],
  ['/api/v1/targets', 'TargetCreate', ['name', 'kind']],
  ['/api/v1/configs', 'ConfigCreate', ['name', 'target_id', 'model_id']],
  ['/api/v1/experiments', 'ExperimentCreate', ['name', 'dataset_version_id', 'candidate_a_id', 'candidate_b_id']],
  ['/api/v1/gates', 'GateCreate', ['name']],
  ['/api/v1/reviews/{review_id}/decision', 'ReviewInput', ['label']],
]

const response = await fetch(url)
if (!response.ok) throw new Error(`OpenAPI unavailable: HTTP ${response.status} at ${url}`)
const spec = await response.json()
if (spec.info?.title !== 'EvalBoard API') throw new Error(`Wrong API at ${url}: expected EvalBoard API, received ${spec.info?.title ?? 'unknown service'}`)
const problems = []
for (const [method, path] of endpoints) {
  if (!spec.paths?.[path]?.[method]) problems.push(`Missing ${method.toUpperCase()} ${path}`)
}
for (const [path, schemaName, properties] of requiredBodies) {
  const requestSchema = spec.paths?.[path]?.post?.requestBody?.content?.['application/json']?.schema
  const actualName = requestSchema?.$ref?.split('/').at(-1)
  if (actualName !== schemaName) problems.push(`POST ${path} body changed: expected ${schemaName}, got ${actualName ?? 'none'}`)
  const model = spec.components?.schemas?.[schemaName]
  for (const property of properties) {
    if (!model?.properties?.[property]) problems.push(`${schemaName} missing ${property}`)
  }
}
if (problems.length) {
  console.error(`API contract mismatch (${problems.length}):\n${problems.map((problem) => `- ${problem}`).join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Validated ${endpoints.length} client operations and ${requiredBodies.length} request schemas against ${url}`)
}
