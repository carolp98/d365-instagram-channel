@description('Location for all resources.')
param location string = resourceGroup().location

@description('Base name used for the Container App and its environment.')
@minLength(3)
@maxLength(24)
param appName string = 'ig-d365-relay'

@description('Container image to deploy. Defaults to the public prebuilt relay image.')
param containerImage string = 'ghcr.io/carolp98/d365-instagram-channel:latest'

@description('Instagram App Secret (Meta app > Settings > Basic). Used to verify webhook signatures.')
@secure()
param instagramAppSecret string

@description('A verify token you invent. Enter the SAME value in the Meta webhook configuration.')
@secure()
param instagramVerifyToken string

@description('Long-lived Instagram User access token used to send replies.')
@secure()
param instagramAccessToken string

@description('Your Instagram professional account ID (IG_ID).')
param instagramAccountId string

@description('Direct Line secret from the Dynamics 365 Omnichannel custom messaging channel.')
@secure()
param directLineSecret string

var logName = '${appName}-logs'
var envName = '${appName}-env'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource managedEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      // External ingress so Meta can reach the webhook over HTTPS.
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      // Secrets are stored masked, never as plain environment values.
      secrets: [
        {
          name: 'instagram-app-secret'
          value: instagramAppSecret
        }
        {
          name: 'instagram-verify-token'
          value: instagramVerifyToken
        }
        {
          name: 'instagram-access-token'
          value: instagramAccessToken
        }
        {
          name: 'direct-line-secret'
          value: directLineSecret
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'relay'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'PORT'
              value: '8080'
            }
            {
              name: 'INSTAGRAM_ACCOUNT_ID'
              value: instagramAccountId
            }
            {
              name: 'INSTAGRAM_APP_SECRET'
              secretRef: 'instagram-app-secret'
            }
            {
              name: 'INSTAGRAM_VERIFY_TOKEN'
              secretRef: 'instagram-verify-token'
            }
            {
              name: 'INSTAGRAM_ACCESS_TOKEN'
              secretRef: 'instagram-access-token'
            }
            {
              name: 'DIRECT_LINE_SECRET'
              secretRef: 'direct-line-secret'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
          ]
        }
      ]
      // Single replica: the relay keeps conversation state in memory.
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

@description('Paste this URL into the Meta webhook configuration as the Callback URL.')
output webhookUrl string = 'https://${app.properties.configuration.ingress.fqdn}/webhooks/instagram'

@description('Open this in a browser to run the guided Setup Assistant (test keys, subscribe webhook, refresh token).')
output setupUrl string = 'https://${app.properties.configuration.ingress.fqdn}/setup'

@description('Health endpoint to confirm the relay is running.')
output healthUrl string = 'https://${app.properties.configuration.ingress.fqdn}/health'
