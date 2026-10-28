const HIGH_RISK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(who|what)\s+is\s+the\s+(current|present|incumbent)\b/i, 'a'],
  [/\b(current|present|incumbent)\s+(president|prime\s*minister|ceo|cto|cfo|chancellor|governor|mayor|pope|secretary|chairman|chair|director)\b/i, 'b'],
]
const EXCLUSION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(code|function|bug|error|stack\s*trace|compile|refactor|debug|python|javascript|typescript)\b/i, 'coding'],
]
const q = "Who is the current CEO of NVIDIA?"
console.log('pattern a:', HIGH_RISK_PATTERNS[0][0].test(q))
console.log('pattern b:', HIGH_RISK_PATTERNS[1][0].test(q))
console.log('coding exclusion:', EXCLUSION_PATTERNS[0][0].test(q))
