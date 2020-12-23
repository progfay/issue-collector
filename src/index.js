const CDP = require('chrome-remote-interface')
const { Certificate } = require('@fidm/x509')
const urls = require('./urls')

const SUBSCRIBE_DOMAINS = ['Log', 'Audits', 'Runtime', 'Security', 'Page']

const main = async () => {
  const client = await CDP({
    port: 9222,
    host: process.env.CHROME_HOST ?? 'localhost',
  })
  console.warn(await client.Browser.getVersion())

  let url = ''
  const issues = []

  await client.Target.setAutoAttach({
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  })

  const unsubscribeFunctions = await Promise.all([
    client.Log.entryAdded(({ entry }) => {
      issues.push({ type: 'log', url, entry })
      console.warn({ type: 'log', url, entry: entry?.text })
    }),
    client.Audits.issueAdded(({ issue }) => {
      issues.push({ type: 'issue', url, issue })
      console.warn({ type: 'issue', url, issue: issue?.code })
    }),
    client.Runtime.consoleAPICalled(message => {
      issues.push({ type: 'console', url, message })
      console.warn({ type: 'console', url, message })
    }),
    client.Security.securityStateChanged(security => {
      if (['secure', 'neutral'].includes(security.securityState)) return
      issues.push({ type: 'security', url, security })
      console.warn({ type: 'security', url, security })
    }),
    client.Security.securityStateChanged(security => {
      const certificates = security.explanations.flatMap(
        explanation => explanation.certificate,
      )
      for (const certificate of certificates) {
        const x509cert =
          '-----BEGIN CERTIFICATE-----\n' +
          certificate.replace(/(.{64})/g, '$1\n') +
          '\n-----END CERTIFICATE-----'
        const { validTo, issuer } = Certificate.fromPEM(x509cert)
        const daysLeft =
          (validTo.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
        if (daysLeft <= 30) {
          const info = {
            validTo,
            issuer: issuer.commonName,
          }
          issues.push({ type: 'certificate', url, info })
          console.warn({ type: 'certificate', url, info })
        }
      }
    }),
  ])

  await Promise.all(SUBSCRIBE_DOMAINS.map(domain => client[domain].enable()))

  const detectingScript = await client.Page.addScriptToEvaluateOnNewDocument({
    source: `
        (function (target, prop) {
          let value = 'default'
          Object.defineProperty(target, prop, {
            get: () => value,
            set: v => { value = v },
          })
        })(Notification, 'permission')
      `,
  })

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

  for (let i = 0; i < urls.length; i++) {
    url = urls[i]
    console.warn(url)
    const { targetId } = await client.Target.createTarget({
      url: 'about:blank',
    })
    await client.Target.activateTarget({ targetId })
    await client.Page.navigate({ url })
    const { timeout } = await Promise.race([
      client.Page.loadEventFired().then(() => ({ timeout: false })),
      new Promise(resolve => {
        setTimeout(resolve, 45000)
      }).then(() => ({ timeout: true })),
    ])
    if (timeout) {
      issues.push({ type: 'timeout', url })
      console.warn({ type: 'timeout', url })
    }
    await client.Target.closeTarget({ targetId })
  }

  await Promise.all(unsubscribeFunctions.map(fun => fun()))
  await client.Page.removeScriptToEvaluateOnNewDocument(detectingScript)
  await client.Log.stopViolationsReport()
  await client.Log.clear()
  await Promise.all(SUBSCRIBE_DOMAINS.map(domain => client[domain].disable()))
  await client.close()

  console.log(JSON.stringify(issues))
}

main().catch(console.error)
