const CDP = require('chrome-remote-interface')

const urlList = ['http://localhost:8000']

const main = async () => {
  const client = await CDP({
    port: 9222,
    host: process.env.CHROME_HOST ?? 'localhost',
  })

  let url = ''
  const issues = []

  await client.Log.entryAdded(entry => {
    issues.push({ type: 'log', url, entry })
  })
  await client.Log.enable()
  await client.Audits.issueAdded(issue => {
    issues.push({ type: 'log', url, issue })
  })
  await client.Audits.enable()
  await client.Page.enable()

  for (let i = 0; i < urlList.length; i++) {
    url = urlList[i]
    await client.Page.navigate({ url })
    await client.Page.loadEventFired()
  }

  await client.Log.disable()
  await client.Page.disable()
  await client.close()

  console.log(JSON.stringify(issues, undefined, 2))
}

main().catch(console.error)
