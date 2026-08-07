function fail(message) {
  throw new Error(message || 'Assertion failed')
}

function equal(actual, expected, message = '') {
  if (actual !== expected) {
    fail(`${message || 'Values are not equal'}\nexpected: ${expected}\nactual: ${actual}`)
  }
}

function notEqual(actual, expected, message = '') {
  if (actual === expected) {
    fail(`${message || 'Values should not be equal'}\nunexpected: ${expected}`)
  }
}

function ok(value, message = '') {
  if (!value) fail(message || 'Expected value to be truthy')
}

function deepEqual(actual, expected, message = '') {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    fail(`${message || 'Values are not deeply equal'}\nexpected: ${expectedText}\nactual: ${actualText}`)
  }
}

function match(actual, pattern, message = '') {
  const text = String(actual ?? '')
  const re = pattern instanceof RegExp ? pattern : new RegExp(String(pattern))
  if (!re.test(text)) {
    fail(`${message || 'Value does not match pattern'}\npattern: ${re}\nactual: ${text}`)
  }
}

module.exports = { equal, notEqual, ok, deepEqual, fail, match }
