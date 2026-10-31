import XCTest
@testable import Inboxies

/// "Confirm it's you" for `reauth_required` (AVE-170): the 403 body, the
/// retry-once rule, and the shared prompt.
final class ReauthTests: XCTestCase {
    // MARK: - Decoding the 403

    private let gateBody = """
    {"error":"For your security, confirm it's you first. Sign out and sign back in, then try again within 5 minutes.",
     "message":"For your security, confirm it's you first. Sign out and sign back in, then try again within 5 minutes.",
     "code":"reauth_required","maxAgeSeconds":300,
     "methods":["password","passkey","sign_in"],"twoFactor":true,"emailCodeTo":null}
    """

    func testParsesReauthRequiredBody() throws {
        let challenge = try XCTUnwrap(ReauthChallenge.parse(statusCode: 403, data: Data(gateBody.utf8)))
        XCTAssertEqual(challenge.methods, [.password, .passkey, .signIn])
        XCTAssertEqual(challenge.usableMethods, [.password, .passkey])
        XCTAssertTrue(challenge.twoFactor)
        XCTAssertNil(challenge.emailCodeTo)
        XCTAssertEqual(challenge.maxAgeSeconds, 300)
        XCTAssertTrue(challenge.message.hasPrefix("For your security"))
    }

    func testParsesEmailCodeAccount() throws {
        let body = #"{"code":"reauth_required","methods":["email_code","sign_in"],"twoFactor":false,"emailCodeTo":"a•••p@gmail.com","maxAgeSeconds":300}"#
        let challenge = try XCTUnwrap(ReauthChallenge.parse(statusCode: 403, data: Data(body.utf8)))
        XCTAssertEqual(challenge.methods, [.emailCode, .signIn])
        XCTAssertEqual(challenge.emailCodeTo, "a•••p@gmail.com")
        XCTAssertFalse(challenge.twoFactor)
    }

    func testUnknownOrMissingMethodsFallBackToSignIn() throws {
        let body = #"{"code":"reauth_required","methods":["carrier_pigeon"]}"#
        let challenge = try XCTUnwrap(ReauthChallenge.parse(statusCode: 403, data: Data(body.utf8)))
        XCTAssertEqual(challenge.methods, [.signIn])
        XCTAssertTrue(challenge.usableMethods.isEmpty)
        XCTAssertEqual(challenge.maxAgeSeconds, 300)

        // email_code with nowhere to send it isn't offered.
        let noTarget = #"{"code":"reauth_required","methods":["email_code","sign_in"],"emailCodeTo":null}"#
        XCTAssertEqual(ReauthChallenge.parse(statusCode: 403, data: Data(noTarget.utf8))?.methods, [.signIn])
    }

    func testOtherErrorsAreNotChallenges() {
        XCTAssertNil(ReauthChallenge.parse(statusCode: 401, data: Data(gateBody.utf8)), "only a 403 is the gate")
        XCTAssertNil(ReauthChallenge.parse(statusCode: 403, data: Data(#"{"error":"Forbidden"}"#.utf8)))
        XCTAssertNil(ReauthChallenge.parse(statusCode: 403, data: Data(#"{"code":"service_ended","domain":"x.com"}"#.utf8)))
        XCTAssertNil(ReauthChallenge.parse(statusCode: 403, data: Data("not json".utf8)))
    }

    func testErrorDescriptionUsesServerSentence() throws {
        let challenge = try XCTUnwrap(ReauthChallenge.parse(statusCode: 403, data: Data(gateBody.utf8)))
        XCTAssertEqual(APIError.reauthRequired(challenge).errorDescription, challenge.message)
        var bare = challenge
        bare.message = ""
        XCTAssertFalse((APIError.reauthRequired(bare).errorDescription ?? "").isEmpty)
    }

    // MARK: - Retry once

    private func challenge() -> ReauthChallenge {
        ReauthChallenge(methods: [.password, .signIn], twoFactor: false, emailCodeTo: nil, maxAgeSeconds: 300, message: "m")
    }

    func testConfirmedPromptRetriesOnce() async throws {
        var calls = 0
        var prompts = 0
        let gate = challenge()
        let value: String = try await ReauthRetry.run(confirm: { _ in prompts += 1; return true }) {
            calls += 1
            if calls == 1 { throw APIError.reauthRequired(gate) }
            return "ok"
        }
        XCTAssertEqual(value, "ok")
        XCTAssertEqual(calls, 2)
        XCTAssertEqual(prompts, 1)
    }

    func testDeclinedPromptDoesNotRetry() async {
        var calls = 0
        let gate = challenge()
        do {
            let _: String = try await ReauthRetry.run(confirm: { _ in false }) {
                calls += 1
                throw APIError.reauthRequired(gate)
            }
            XCTFail("expected reauthRequired")
        } catch APIError.reauthRequired(let thrown) {
            XCTAssertEqual(thrown, gate)
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(calls, 1)
    }

    func testSecondGateIsThrownWithoutAnotherPrompt() async {
        var calls = 0
        var prompts = 0
        let gate = challenge()
        do {
            let _: String = try await ReauthRetry.run(confirm: { _ in prompts += 1; return true }) {
                calls += 1
                throw APIError.reauthRequired(gate)
            }
            XCTFail("expected reauthRequired")
        } catch APIError.reauthRequired {
            // expected
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(calls, 2, "retried exactly once")
        XCTAssertEqual(prompts, 1, "never loops back to the prompt")
    }

    func testOtherErrorsSkipThePrompt() async {
        var prompts = 0
        do {
            let _: String = try await ReauthRetry.run(confirm: { _ in prompts += 1; return true }) {
                throw APIError.http(400, "Bad request")
            }
            XCTFail("expected http error")
        } catch APIError.http(let status, _) {
            XCTAssertEqual(status, 400)
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(prompts, 0)
    }

    // MARK: - Shared prompt

    @MainActor
    func testPromptWithoutHostDeclinesImmediately() async {
        let coordinator = ReauthCoordinator()
        let ok = await coordinator.confirm(challenge())
        XCTAssertFalse(ok)
        XCTAssertNil(coordinator.challenge)
    }

    @MainActor
    func testOnePromptAnswersEveryWaitingRequest() async {
        let coordinator = ReauthCoordinator()
        let host = UUID()
        coordinator.register(host: host)
        XCTAssertEqual(coordinator.activeHost, host)

        async let first = coordinator.confirm(challenge())
        async let second = coordinator.confirm(challenge())
        // Let both requests start waiting.
        for _ in 0..<100 where coordinator.waitingCount < 2 { await Task.yield() }
        XCTAssertEqual(coordinator.waitingCount, 2)
        XCTAssertNotNil(coordinator.challenge)
        coordinator.finish(true)
        let results = await [first, second]
        XCTAssertEqual(results, [true, true])
        XCTAssertNil(coordinator.challenge)
    }

    @MainActor
    func testRemovingTheLastHostCancelsThePrompt() async {
        let coordinator = ReauthCoordinator()
        let host = UUID()
        coordinator.register(host: host)
        async let answer = coordinator.confirm(challenge())
        for _ in 0..<100 where coordinator.waitingCount < 1 { await Task.yield() }
        coordinator.unregister(host: host)
        let ok = await answer
        XCTAssertFalse(ok)
        XCTAssertNil(coordinator.activeHost)
    }
}
