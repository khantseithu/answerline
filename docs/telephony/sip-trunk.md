# Connect any SIP trunk

Answerline answers phone calls through the LiveKit SIP service, so any carrier or PBX that can send a SIP INVITE to it should work, for example another carrier's SIP trunk or a FreePBX/Asterisk box. Only Twilio and Telnyx have guides so far. Their step-by-step guides with setup scripts: [Twilio](twilio.md), [Telnyx](telnyx.md).

Start with [Connect a phone number](../telephony.md) for the server-side requirements (a public host for the SIP service, open ports).

## How a call is routed

1. Your provider sends an INVITE for the dialed number to `sip:<your SIP host>:5060`.
2. The LiveKit SIP service matches the dialed number to an inbound trunk. Each Answerline number has its own trunk.
3. The trunk's dispatch rule creates a room `call-_<caller>_<random>` and dispatches the agent named `AGENT_NAME`, with `{"agent": "<slug>"}` metadata that picks which agent config answers.
4. The agent records the call with the caller's number (`sip.phoneNumber`) and the dialed number (`sip.trunkPhoneNumber`).

## Provider settings

In your provider's portal, create a SIP trunk (sometimes called a SIP connection, SIP URI, or termination route) for inbound calls:

| Setting | Value |
|---|---|
| Destination / origination URI | `sip:<your SIP host>:5060` (hostname or public IP) |
| Transport | TCP or UDP. The SIP service listens on both; TCP avoids fragmented INVITEs |
| Number format | E.164 with `+` (`+15551234567`) for both the dialed number and the caller ID |
| Codecs | G.711 (PCMU/PCMA); G.722 also works |
| DTMF | RFC 2833 / RFC 4733 telephone events |
| Authentication | IP allowlist on your side, or digest credentials (see below) |

The dialed number must reach the SIP service exactly as you connect it in Answerline. If your provider sends `15551234567` or a national format, change the provider's number format to E.164, or connect the number in the form the provider sends.

Assign the phone number to that trunk in the provider's portal.

## Connect the number in Answerline

```bash
pnpm sip add +15551234567 bright-smile-dental
```

Or use the Phone numbers page in the dashboard. Optional restrictions on who may send calls for the number:

```bash
# Accept INVITEs only from the provider's signaling addresses
pnpm sip add +15551234567 bright-smile-dental --allowed-address 198.51.100.0/24

# Require digest auth, if your provider can authenticate to you
pnpm sip add +15551234567 bright-smile-dental --auth-username answerline --auth-password '<a long random password>'
```

`pnpm sip list` shows connected numbers, `pnpm sip assign <number> <agent>` changes the agent, and `pnpm sip remove <number>` disconnects it.

## Call transfer (SIP REFER)

The agent's `transfer_call` tool and after-hours `transfer` routing do a cold transfer: LiveKit sends a SIP REFER asking your provider to connect the caller to the target (`tel:+15557654321` or a `sip:` URI) and drops the agent from the call. Your provider must accept REFER on the trunk, and transfers to phone numbers must be allowed to reach the PSTN. Most providers disable this by default:

- Look for a setting named "SIP REFER", "call transfer", or "blind transfer" on the trunk and enable it.
- If transfers to phone numbers fail but SIP targets work, enable outbound or PSTN calling for the trunk (some providers call this an outbound voice profile or termination).
- If the provider can't handle REFER, use a `sip:` target your PBX can take, or use `voicemail` for after-hours instead of `transfer`.

## Test

Call the number. You should hear the agent's greeting, and after you hang up the call is stored with `channel = sip` and the caller's number.

If it fails, check `docker compose logs sip`:

- **No INVITE in the logs:** the provider can't reach the host. Check the URI, DNS, and that TCP/UDP 5060 is open.
- **INVITE rejected, no matching trunk:** the dialed number in the INVITE doesn't match a connected number (format mismatch), or `--allowed-address` / auth rejected the source.
- **Call answers but no audio:** RTP is blocked or the SIP service announces a private address. Set `SIP_PUBLIC_IP` and open the RTP UDP range.
- **The agent never joins:** the running agent's `AGENT_NAME` differs from the one the number was connected with. Run `pnpm sip assign` with the right environment.
