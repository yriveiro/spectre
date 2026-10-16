# JWT Plugin
This plugin adds support for using JWT in Elysia handlers.

## Installation
```bash
bun add @elysiajs/jwt
```

## Basic Usage
```typescript [cookie]
import { Elysia } from 'elysia'
import { jwt } from '@elysiajs/jwt'

const app = new Elysia()
    .use(
        jwt({
            name: 'jwt',
            secret: 'Fischl von Luftschloss Narfidort'
        })
    )
    .get('/sign/:name', async ({ jwt, params: { name }, cookie: { auth } }) => {
    	const value = await jwt.sign({ name })

        auth.set({
            value,
            httpOnly: true,
            maxAge: 7 * 86400,
            path: '/profile',
        })

        return `Sign in as ${value}`
    })
    .get('/profile', async ({ jwt, status, cookie: { auth } }) => {
        const profile = await jwt.verify(auth.value)

        if (!profile)
            return status(401, 'Unauthorized')

        return `Hello ${profile.name}`
    })
    .listen(3000)
```

## Config
This plugin extends config from [jose](https://github.com/panva/jose).

The plugin accepts the config below.

### name
Name to register `jwt` function as.

For example, `jwt` function will be registered with a custom name.
```typescript
const jwtSecret = process.env.JWT_SECRETS
if (!jwtSecret) throw new Error('JWT_SECRETS is required')

new Elysia()
    .use(
        jwt({
            name: 'myJWTNamespace',
            secret: jwtSecret
        })
    )
    .get('/sign/:name', ({ myJWTNamespace, params }) => {
        return myJWTNamespace.sign(params)
    })
```

Because some might need to use multiple `jwt` with different configs in a single server, register the JWT function with a different name.

### secret
The private key to sign JWT payload with.

### schema
Type strict validation for JWT payload.

### alg
@default `HS256`

Signing Algorithm to sign JWT payload with.

Possible properties for jose are:
HS256
HS384
HS512
PS256
PS384
PS512
RS256
RS384
RS512
ES256
ES256K
ES384
ES512
EdDSA

### iss
The issuer claim identifies the principal that issued the JWT as per [RFC7519](https://www.rfc-editor.org/rfc/rfc7519#section-4.1.1)

TLDR: usually the domain name of the signer.

### sub
The subject claim identifies the principal that is the subject of the JWT.

The claims in a JWT are usually statements about the subject as per [RFC7519](https://www.rfc-editor.org/rfc/rfc7519#section-4.1.2)

### aud
The audience claim identifies the intended recipients of the JWT.

Each principal intended to process the JWT MUST identify itself with a value in the audience claim as per [RFC7519](https://www.rfc-editor.org/rfc/rfc7519#section-4.1.3)

### jti
JWT ID claim provides a unique identifier for the JWT as per [RFC7519](https://www.rfc-editor.org/rfc/rfc7519#section-4.1.7)

### nbf
The "not before" claim identifies the time before which the JWT must not be accepted for processing as per [RFC7519](https://www.rfc-editor.org/rfc/rfc7519#section-4.1.5)

### exp
The expiration time claim identifies the expiration time on or after which the JWT MUST NOT be accepted for processing as per [RFC7519](https://www.rfc-editor.org/rfc/rfc7519#section-4.1.4)

### iat
The "issued at" claim identifies the time the issuer issued the JWT.

This claim can be used to determine the age of the JWT as per [RFC7519](https://www.rfc-editor.org/rfc/rfc7519#section-4.1.6)

### b64
This JWS Extension Header Parameter modifies the JWS Payload representation and the JWS Signing input computation as per [RFC7797](https://www.rfc-editor.org/rfc/rfc7797).

### kid
A hint indicating which key secured the JWS.

This parameter allows originators to explicitly signal a change of key to recipients as per [RFC7515](https://www.rfc-editor.org/rfc/rfc7515#section-4.1.4)

### x5t
(X.509 certificate SHA-1 thumbprint) header parameter is a base64url-encoded SHA-1 digest of the DER encoding of the X.509 certificate [RFC5280](https://www.rfc-editor.org/rfc/rfc5280). The digest corresponds to the key used to digitally sign the JWS, as per [RFC7515](https://www.rfc-editor.org/rfc/rfc7515#section-4.1.7)

### x5c
(X.509 certificate chain) header parameter contains the X.509 public key certificate or certificate chain [RFC5280](https://www.rfc-editor.org/rfc/rfc5280). The chain corresponds to the key used to digitally sign the JWS, as per [RFC7515](https://www.rfc-editor.org/rfc/rfc7515#section-4.1.6)

### x5u
(X.509 URL) header parameter is a URI [RFC3986](https://www.rfc-editor.org/rfc/rfc3986) that refers to a resource for the X.509 public key certificate or certificate chain [RFC5280]. The certificate corresponds to the key used to digitally sign the JWS, as per [RFC7515](https://www.rfc-editor.org/rfc/rfc7515#section-4.1.5)

### jwk
The "jku" (JWK Set URL) Header Parameter is a URI [RFC3986]. It refers to a resource for a set of JSON-encoded public keys. One of them corresponds to the key used to digitally sign the JWS.

The keys MUST be encoded as a JWK Set [JWK] as per [RFC7515](https://www.rfc-editor.org/rfc/rfc7515#section-4.1.2)

### typ
JWS applications use the `typ` (type) Header Parameter to declare the media type [IANA.MediaTypes] of this complete JWS.

Use this when more than one kind of object could be present in an application data structure. Such a structure can contain a JWS, as per [RFC7515](https://www.rfc-editor.org/rfc/rfc7515#section-4.1.9)

### ctr
JWS applications use the Content-Type parameter to declare the media type [IANA.MediaTypes] of the secured content (the payload).

Use this when more than one kind of object could be present in the JWS Payload as per [RFC7515](https://www.rfc-editor.org/rfc/rfc7515#section-4.1.9)

## Handler
Below are the value added to the handler.

### jwt.sign
A dynamic object of collection related to use with JWT registered by the JWT plugin.

Type:
```typescript
sign: (payload: JWTPayloadSpec): Promise<string>
```

`JWTPayloadSpec` accepts the same value as [JWT config](#config)

### jwt.verify
Verify payload with the provided JWT config

Type:
```typescript
verify(payload: string) => Promise<JWTPayloadSpec | false>
```

`JWTPayloadSpec` accepts the same value as [JWT config](#config)

## Pattern
Below you can find the common patterns to use the plugin.

## Set JWT expiration date
By default, the plugin passes the config to `setCookie`, and the config inherits its value.

```typescript
const app = new Elysia()
    .use(
        jwt({
            name: 'jwt',
            secret: 'kunikuzushi',
            exp: '7d'
        })
    )
    .get('/sign/:name', async ({ jwt, params }) => jwt.sign(params))
```

This will sign JWT with an expiration date of the next 7 days.
