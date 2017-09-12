const mosca = require('mosca');

export const sigv4utilsMock = {
   getSignedUrl: (endpoint, region, credentials) => {
    return 'ws://localhost:3000/mqtt';
  },
  getSignatureKey: (key, date, region, service) => 'test',
};

export const createMqttServer = () => {
  const server = new mosca.Server({
    http: {
      port: 3000,
      bundle: true,
      static: './',
    },
  });
  return server;
};

export const startSubscriptionOperationMessage = {
  'query': {
    'kind': 'Document',
    'definitions': [
      {
        'kind': 'OperationDefinition',
        'operation': 'subscription',
        'name': {
          'kind': 'Name',
          'value': 'TeamTodoAdded',
        },
        'variableDefinitions': [
          {
            'kind': 'VariableDefinition',
            'variable': {
              'kind': 'Variable',
              'name': {
                'kind': 'Name',
                'value': 'teamName',
              },
            },
            'type': {
              'kind': 'NonNullType',
              'type': {
                'kind': 'NamedType',
                'name': {
                  'kind': 'Name',
                  'value': 'String',
                },
              },
            },
            'defaultValue': null,
          },
        ],
        'directives': [],
        'selectionSet': {
          'kind': 'SelectionSet',
          'selections': [
            {
              'kind': 'Field',
              'alias': null,
              'name': {
                'kind': 'Name',
                'value': 'teamTodoAdded',
              },
              'arguments': [
                {
                  'kind': 'Argument',
                  'name': {
                    'kind': 'Name',
                    'value': 'teamName',
                  },
                  'value': {
                    'kind': 'Variable',
                    'name': {
                      'kind': 'Name',
                      'value': 'teamName',
                    },
                  },
                },
              ],
              'directives': [],
              'selectionSet': {
                'kind': 'SelectionSet',
                'selections': [
                  {
                    'kind': 'Field',
                    'alias': null,
                    'name': {
                      'kind': 'Name',
                      'value': 'id',
                    },
                    'arguments': [],
                    'directives': [],
                    'selectionSet': null,
                  },
                  {
                    'kind': 'Field',
                    'alias': null,
                    'name': {
                      'kind': 'Name',
                      'value': 'name',
                    },
                    'arguments': [],
                    'directives': [],
                    'selectionSet': null,
                  },
                  {
                    'kind': 'Field',
                    'alias': null,
                    'name': {
                      'kind': 'Name',
                      'value': 'author',
                    },
                    'arguments': [],
                    'directives': [],
                    'selectionSet': null,
                  },
                  {
                    'kind': 'Field',
                    'alias': null,
                    'name': {
                      'kind': 'Name',
                      'value': 'content',
                    },
                    'arguments': [],
                    'directives': [],
                    'selectionSet': null,
                  },
                  {
                    'kind': 'Field',
                    'alias': null,
                    'name': {
                      'kind': 'Name',
                      'value': 'timestamp',
                    },
                    'arguments': [],
                    'directives': [],
                    'selectionSet': null,
                  },
                  {
                    'kind': 'Field',
                    'name': {
                      'kind': 'Name',
                      'value': '__typename',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ],
    'loc': {
      'start': 0,
      'end': 170,
      'source': {
        'body': 'subscription TeamTodoAdded($teamName: String!) {\n ' +
        'teamTodoAdded(teamName:$teamName) {\n id\n name\n author\ncontent\ntimestamp\n    }\n}\n',
        'name': 'GraphQL request',
        'locationOffset': {
          'line': 1,
          'column': 1,
        },
      },
    },
  },
  'variables': {
    'teamName': 'team 2',
  },
  'operationName': 'TeamTodoAdded',
  'subscriptionName': 'teamTodoAdded',
};
