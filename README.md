# graphql-aws-iot-ws-client

# WS client for serverless subscriptions queries and mutations that is compatible with Apollo Client.

apollo module - setting up client in Angular
``` ts
import { Inject } from '@angular/core';
import { NgModule } from '@angular/core';

import { ApolloModule } from 'apollo-angular';
import { ApolloClient } from 'apollo-client';

import { SubscriptionClient } from 'graphql-aws-iot-ws-client/src/client';

import { getCredentials } from './get-credentials';

import { environment } from '../../environments/environment';
const { region, iotEndpoint, AppPrefix } = environment;


const wsClient = new SubscriptionClient(iotEndpoint, {
    AppPrefix, // Subscription Client publishes to ${AppPrefix}/out as a way to namespace the application in aws iot websockets. The same AppPrefix must be set on the server side (https://github.com/ioxe/graphql-aws-iot-ws-transport)
    region, // required for creating signed url to connect to mqtt websocket (must be region that matches iot endpoint given on server side lambda functions
    reconnect: true 
}, getCredentials);

const client: ApolloClient = new ApolloClient({
    dataIdFromObject: (o: any) => o.id,
    networkInterface: wsClient,
    connectToDevTools: true,
    // queryDeduplication: true
});

export function provideClient(): ApolloClient {
    return client;
}

@NgModule({
    imports: [ApolloModule.forRoot(provideClient)],
    exports: [ApolloModule]
})
export class AppApolloModule { }
```
The major different is the getCredentials function. 
This is a function that should return a promise and will be executed prior to connecting to the client.
This function has the option of returning a clientId. For example if you are using AWS Cognito for authentication the clientId must be the identityId.
If you use tokens for authentication I recommend that you use a client id that is composed from the token. The clientId is persistently sent to the server for transactions.


# Example of getCredentials function which uses Cognito

``` ts
import { environment } from '../../environments/environment';

import { CognitoIdentityCredentials } from 'aws-sdk/global';

declare var AWS: any;
AWS.config.region = 'us-west-2';
import { Credentials } from 'aws-sdk/global';

export const getCredentials = () => {
    let credentials;
    if (localStorage.getItem('credentials')) {
        const identityId = JSON.parse(localStorage.getItem('credentials'))._identityId; // reuse unauthenticated identity if exists
        credentials = new CognitoIdentityCredentials({
            IdentityId: identityId,
        });
    } else {
        credentials = new CognitoIdentityCredentials({
            IdentityPoolId: environment.identityPoolId,
        });
    }
    return credentials.refreshPromise().then((res: any) => {
        localStorage.setItem('credentials', JSON.stringify(credentials));
        return { credentials, clientId: credentials._identityId };
    });
};
```
# See full example app at
https://github.com/ioxe/graphql-aws-iot-ws-transport-example
