import { SubscriptionClient } from './client';
/**
 * @deprecated This method will become deprecated in the new package graphql-transport-ws.
 * Start using the GraphQLTransportWSClient to make queries, mutations and subscriptions over websockets.
 */
export declare function addGraphQLSubscriptions(networkInterface: any, wsClient: SubscriptionClient): any;
