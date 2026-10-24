import XCTest
@testable import Inboxies

/// Wire handling for passkey sign-in and the two-factor challenge (AVE-76).
final class PasskeysTwoFactorTests: XCTestCase {
    // MARK: - Two-factor challenge

    func testParsesTwoFactorChallengeFromPasswordSignIn() throws {
        let body = """
        {"error":"Enter the code from your authenticator app.","code":"TWO_FACTOR_REQUIRED",
         "twoFactorRequired":true,"twoFactorMethods":["totp","backup_code"],"twoFactorToken":"abc.def%2B"}
        """
        let challenge = try XCTUnwrap(TwoFactorChallenge.parse(Data(body.utf8)))
        XCTAssertEqual(challenge.token, "abc.def%2B")
        XCTAssertEqual(challenge.methods, ["totp", "backup_code"])
    }

    func testOrdinaryFailedSignInIsNotAChallenge() {
        XCTAssertNil(TwoFactorChallenge.parse(Data(#"{"error":"Invalid email or password"}"#.utf8)))
        XCTAssertNil(TwoFactorChallenge.parse(Data(#"{"twoFactorRequired":true}"#.utf8)), "no token, no challenge")
        XCTAssertNil(TwoFactorChallenge.parse(Data("not json".utf8)))
    }

    func testResetPasswordReplyCarriesChallengeOrSession() throws {
        let challengeReply = try JSONDecoder().decode(
            ResetPasswordResponse.self,
            from: Data(#"{"ok":true,"twoFactorRequired":true,"twoFactorToken":"t1","twoFactorMethods":["totp","backup_code"]}"#.utf8)
        )
        XCTAssertEqual(challengeReply.twoFactorChallenge?.token, "t1")
        XCTAssertNil(challengeReply.token)

        let sessionReply = try JSONDecoder().decode(
            ResetPasswordResponse.self,
            from: Data(#"{"ok":true,"token":"s1","expiresAt":"2026-11-01T00:00:00.000Z","email":"ada@inboxies.email"}"#.utf8)
        )
        XCTAssertNil(sessionReply.twoFactorChallenge)
        XCTAssertEqual(sessionReply.token, "s1")

        let bare = try JSONDecoder().decode(ResetPasswordResponse.self, from: Data(#"{"ok":true}"#.utf8))
        XCTAssertNil(bare.token)
        XCTAssertNil(bare.twoFactorChallenge)
    }

    func testMeDecodesTwoFactorFlag() throws {
        let me = try JSONDecoder().decode(MeResponse.self, from: Data(#"{"userId":"u","twoFactorEnabled":true}"#.utf8))
        XCTAssertEqual(me.twoFactorEnabled, true)
        let old = try JSONDecoder().decode(MeResponse.self, from: Data(#"{"userId":"u"}"#.utf8))
        XCTAssertNil(old.twoFactorEnabled)
    }

    // MARK: - Passkeys

    func testBase64URLRoundTripsWithoutPadding() throws {
        let bytes = Data([0xfb, 0xff, 0xbf, 0x00, 0x01])
        let encoded = Base64URL.encode(bytes)
        XCTAssertEqual(encoded, "-_-_AAE")
        XCTAssertFalse(encoded.contains("="))
        XCTAssertEqual(Base64URL.decode(encoded), bytes)
        XCTAssertEqual(Base64URL.decode("YQ"), Data("a".utf8))
    }

    func testReadsPasskeyChallengeCookie() throws {
        let url = URL(string: "https://inboxies.email/api/auth/passkey/generate-authenticate-options")!
        let http = try XCTUnwrap(HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": "application/json",
                "Set-Cookie": "__Secure-better-auth.better-auth-passkey=tok123.sig%2Fx; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax",
            ]
        ))
        XCTAssertEqual(
            Passkeys.challengeCookie(from: http),
            "__Secure-better-auth.better-auth-passkey=tok123.sig%2Fx"
        )
        XCTAssertEqual(
            Passkeys.ceremonyHeaders(cookie: "c=v", rpID: "inboxies.app"),
            ["Cookie": "c=v", "Origin": "https://inboxies.app"]
        )
    }

    func testNoChallengeCookieMeansNoCeremony() throws {
        let http = try XCTUnwrap(HTTPURLResponse(
            url: URL(string: "https://inboxies.email/api/auth/passkey/generate-authenticate-options")!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Set-Cookie": "other=1; Path=/"]
        ))
        XCTAssertNil(Passkeys.challengeCookie(from: http))
    }

    func testBearerTokenFromSetAuthTokenDropsSignature() throws {
        let http = try XCTUnwrap(HTTPURLResponse(
            url: URL(string: "https://inboxies.email/api/auth/passkey/verify-authentication")!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["set-auth-token": "rawSessionToken.c2lnbmF0dXJl"]
        ))
        XCTAssertEqual(Passkeys.bearerToken(from: http), "rawSessionToken")
    }

    func testFriendlyPasskeyErrors() {
        let notFound = Passkeys.friendly(
            APIError.http(401, #"{"code":"PASSKEY_NOT_FOUND","message":"Passkey not found"}"#),
            fallback: "x"
        )
        XCTAssertEqual(notFound.localizedDescription, "That passkey isn't registered with Inboxies. Sign in another way.")
        let stale = Passkeys.friendly(
            APIError.http(403, #"{"code":"SESSION_NOT_FRESH","message":"Session is not fresh"}"#),
            fallback: "x"
        )
        XCTAssertTrue(stale.localizedDescription.contains("sign out and sign in again"))
        XCTAssertEqual(Passkeys.friendly(APIError.http(500, "boom"), fallback: "fallback").localizedDescription, "fallback")
        XCTAssertTrue(Passkeys.friendly(APIError.http(429, "{}"), fallback: "x").localizedDescription.contains("Too many"))
    }
}
