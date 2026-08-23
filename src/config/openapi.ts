/**
 * OpenAPI 3 specification for the AdvisorTrack REST API.
 */
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'AdvisorTrack API',
    version: '1.0.0',
    description:
      'REST API for the AdvisorTrack mobile app. Login to receive a JWT, then use it as `Authorization: Bearer <token>` on protected routes.',
  },
  servers: [{ url: '/api/v1', description: 'API v1' }],
  tags: [
    { name: 'Auth', description: 'Login, register, session' },
    { name: 'Contacts', description: 'Client/prospect contacts' },
    { name: 'Activities', description: 'Advisor activities' },
    { name: 'Production', description: 'Production / income entries' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT from POST /auth/login or /auth/register',
      },
    },
    schemas: {
      ApiSuccess: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' },
        },
      },
      ApiError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              code: { type: 'string' },
            },
          },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'john.mitchell@advisortrack.com' },
          password: { type: 'string', example: 'password' },
        },
      },
      RegisterRequest: {
        type: 'object',
        required: ['firstName', 'lastName', 'email', 'password'],
        properties: {
          firstName: { type: 'string', example: 'Jane' },
          lastName: { type: 'string', example: 'Advisor' },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'JWT valid for JWT_EXPIRES_IN (default 7 days)' },
          user: { $ref: '#/components/schemas/User' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          company: { type: 'string' },
          role: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Contact: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          status: { type: 'string', enum: ['prospect', 'active', 'inactive'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          rating: { type: 'number' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateContactRequest: {
        type: 'object',
        required: ['firstName', 'lastName', 'email', 'phone'],
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          status: { type: 'string', enum: ['prospect', 'active', 'inactive'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          rating: { type: 'number' },
          notes: { type: 'string' },
        },
      },
      CreateActivityRequest: {
        type: 'object',
        required: ['title', 'type', 'scheduledAt'],
        properties: {
          title: { type: 'string' },
          type: { type: 'string', enum: ['call', 'meeting', 'email', 'follow_up', 'presentation', 'other'] },
          status: { type: 'string', enum: ['scheduled', 'completed', 'cancelled'] },
          contactId: { type: 'string' },
          contactName: { type: 'string' },
          description: { type: 'string' },
          scheduledAt: { type: 'string', format: 'date-time' },
          durationMinutes: { type: 'integer' },
        },
      },
      CreateProductionRequest: {
        type: 'object',
        required: ['title', 'type', 'amount', 'date'],
        properties: {
          title: { type: 'string' },
          type: { type: 'string', enum: ['commission', 'fee', 'bonus', 'renewal', 'other'] },
          amount: { type: 'number' },
          contactId: { type: 'string' },
          contactName: { type: 'string' },
          productName: { type: 'string' },
          date: { type: 'string', example: '2025-08-14' },
          notes: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login',
        description: 'Returns a JWT and user profile. Token expires per JWT_EXPIRES_IN (default 7 days).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/ApiSuccess' },
                    { properties: { data: { $ref: '#/components/schemas/AuthResponse' } } },
                  ],
                },
              },
            },
          },
          '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } },
        },
        responses: { '201': { description: 'Account created' } },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Forgot password',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } },
            },
          },
        },
        responses: { '200': { description: 'Reset email stub' } },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current user',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'User profile' }, '401': { description: 'Missing or invalid token' } },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Logged out (client should discard token)' } },
      },
    },
    '/contacts': {
      get: {
        tags: ['Contacts'],
        summary: 'List contacts',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'Contact list' } },
      },
      post: {
        tags: ['Contacts'],
        summary: 'Create contact',
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateContactRequest' } } },
        },
        responses: { '201': { description: 'Contact created' } },
      },
    },
    '/contacts/{id}': {
      get: {
        tags: ['Contacts'],
        summary: 'Get contact by ID',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Contact' }, '404': { description: 'Not found' } },
      },
    },
    '/activities': {
      get: {
        tags: ['Activities'],
        summary: 'List activities',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'date', in: 'query', schema: { type: 'string', example: '2025-06-18' } }],
        responses: { '200': { description: 'Activity list' } },
      },
      post: {
        tags: ['Activities'],
        summary: 'Create activity',
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateActivityRequest' } } },
        },
        responses: { '201': { description: 'Activity created' } },
      },
    },
    '/production': {
      get: {
        tags: ['Production'],
        summary: 'List production entries',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Production list' } },
      },
      post: {
        tags: ['Production'],
        summary: 'Create production entry',
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateProductionRequest' } } },
        },
        responses: { '201': { description: 'Entry created' } },
      },
    },
    '/production/summary': {
      get: {
        tags: ['Production'],
        summary: 'Dashboard production summary',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Monthly totals and goal' } },
      },
    },
  },
} as const;
