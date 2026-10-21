import neostandard from 'neostandard'

// dist is the front build output, not source
export default [{ ignores: ['dist'] }, ...neostandard({})]
