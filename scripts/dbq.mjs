import postgres from 'postgres'
import bcrypt from 'bcryptjs'
const sql = postgres('postgres://bodega_dev:da5542a613360e29286389ad04ee4e90c32729e211c3555fd4b92f3f101c4bb3@127.0.0.1:5433/bodega_dev', { max: 1 })
const newHash = await bcrypt.hash('Chgo1314', 12)
await sql`update users set hashed_password = ${newHash} where email = 'allopze@gmail.com'`
console.log('updated hash for allopze@gmail.com')
const rows = await sql`select email, hashed_password from users where email = 'allopze@gmail.com'`
const match = await bcrypt.compare('Chgo1314', rows[0].hashed_password)
console.log('verify Chgo1314:', match)
await sql.end()
