const CDP = require('chrome-remote-interface')

const urlList = ['http://localhost:8000']

const main = async () => {
  const client = await CDP({
    port: 9222,
    host: process.env.CHROME_HOST ?? 'localhost',
  })

  let url = ''
  const issues = []

  await client.Log.entryAdded(({ entry }) => {
    issues.push({ type: 'log', url, entry })
    console.warn({ type: 'log', url, entry: entry?.text })
  })
  await client.Log.enable()
  // Ref. https://github.com/ChromeDevTools/devtools-frontend/blob/3c7eedcd60a29c2877d06e948e4c95cbc34e56e8/front_end/sdk/LogModel.js#L23-L31
  await client.Log.startViolationsReport({
    config: [
      { name: 'longTask', threshold: 200 },
      { name: 'longLayout', threshold: 30 },
      { name: 'blockedEvent', threshold: 100 },
      { name: 'blockedParser', threshold: -1 },
      { name: 'handler', threshold: 150 },
      { name: 'recurringHandler', threshold: 50 },
      { name: 'discouragedAPIUse', threshold: -1 },
    ],
  })
  await client.Audits.issueAdded(({ issue }) => {
    issues.push({ type: 'issue', url, issue })
    console.warn({ type: 'issue', url, issue: issue?.code })
  })
  await client.Audits.enable()
  client.Runtime.consoleAPICalled(message => {
    issues.push({ type: 'console', url, message })
    console.warn({ type: 'console', url, message })
  })
  await client.Runtime.enable()
  client.Security.securityStateChanged(security => {
    issues.push({ type: 'security', url, security })
    console.warn({ type: 'security', url, security })
  })
  await client.Security.enable()
  await client.Page.enable()

  for (let i = 0; i < urlList.length; i++) {
    url = urlList[i]
    console.warn(url)
    const { targetId } = await client.Target.createTarget({
      url: 'about:blank',
    })
    await client.Target.activateTarget({ targetId })
    await client.Page.navigate({ url })
    await client.Page.loadEventFired()
    await client.Target.closeTarget({ targetId })
  }

  await client.Log.stopViolationsReport()
  await client.Log.disable()
  await client.Audits.disable()
  await client.Runtime.disable()
  await client.Security.disable()
  await client.Page.disable()
  await client.close()

  console.log(JSON.stringify(issues))
}

main().catch(console.error)
