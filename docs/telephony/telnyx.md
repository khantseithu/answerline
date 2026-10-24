# Connect a Telnyx number

This guide routes a Telnyx phone number to an Answerline agent over a Telnyx [FQDN connection](https://developers.telnyx.com/docs/voice/sip-trunking). Calls arrive at your LiveKit SIP service, LiveKit dispatches the agent, and the call is logged with the caller's number.

Start with [Connect a phone number](../telephony.md) for the server-side requirements (a public host for the SIP service, open ports). This page covers the Telnyx side.

## What you need

- A paid Telnyx account (trial accounts are limited) with a voice-capable phone number.
- A Telnyx API v2 key (Mission Control → Account settings → Keys & credentials).
- A DNS name for your SIP service (e.g. `sip.example.com`) with an A record pointing at its public IP, reachable on TCP 5060 and your RTP port range. Telnyx FQDN connections take a hostname, not a bare IP.
- The slug of the agent that should answer, e.g. `bright-smile-dental`.

## Option 1: setup script

Add the key to `.env`:

```bash
TELNYX_API_KEY=KEY...
```

Then run:

```bash
pnpm sip telnyx +15551234567 bright-smile-dental --sip-host sip.example.com
```

The script is safe to re-run. It:

1. Finds or creates an FQDN connection named `answerline`, using TCP, with the caller and dialed numbers sent in `+E.164` format.
2. Adds `sip.example.com:5060` as the connection's FQDN, so Telnyx sends inbound calls to your SIP service.
3. Assigns the phone number to the connection. It stops if the number is assigned to another connection or application.
4. Creates the LiveKit inbound trunk and dispatch rule for the number (or reassigns the agent if the number is already connected).

Check the result with `pnpm sip list`.

## Option 2: Telnyx portal

1. **Create the connection.** Real-Time Communications → Voice → SIP Trunking → Create SIP Connection. Choose FQDN, name it, and add your SIP host with port 5060.
2. **Set the transport and number formats.** Use TCP. On the Inbound tab, set the destination number format and the caller (ANI) number format to `+E.164`. Answerline matches the dialed number exactly as `+15551234567`.
3. **Assign the number.** Numbers → My Numbers → choose the number → set its connection to the one you created.
4. **Connect the number in Answerline:**

   ```bash
   pnpm sip add +15551234567 bright-smile-dental
   ```

   Or use the Phone numbers page in the dashboard.

The API calls behind these steps are in the [LiveKit Telnyx guide](https://docs.livekit.io/telephony/start/providers/telnyx/).

## Enable call transfer (SIP REFER)

The agent's `transfer_call` tool and after-hours `transfer` routing make a cold transfer: LiveKit sends a SIP REFER and Telnyx places a new call from the caller to the target. Telnyx only completes it when:

- the connection has an **outbound voice profile** that allows calls to the transfer destination (Real-Time Communications → Voice → Outbound Voice Profiles; create one and attach it on the connection's Outbound tab), and
- the transfer target is an E.164 number (`+15557654321`) or a `sip:` URI Telnyx can reach.

The setup script does not attach an outbound voice profile, because profiles carry billing and destination limits you should choose yourself. Some accounts also need Telnyx support to enable SIP REFER. If every transfer is declined (603), ask Telnyx support to enable REFER for your connection. See Telnyx's [external transfers](https://developers.telnyx.com/docs/voice/sip-trunking/features/external-transfers) docs.

## Test

Call the number. You should hear the agent's greeting. After you hang up, the call is stored with `channel = sip` and your number as `from_number`.

If the call fails:

- **No INVITE in `docker compose logs sip`:** Telnyx can't reach the host. Check the A record, that TCP 5060 is open, and the connection's FQDN and port.
- **INVITE rejected, no matching trunk:** the dialed number doesn't arrive as `+E.164`. Fix the connection's inbound number format, or check `pnpm sip list`.
- **Answers but no audio:** RTP is blocked or the SIP service announces a private address. Set `SIP_PUBLIC_IP` and open the RTP range (UDP).
- **The agent never joins:** the dispatch rule names `AGENT_NAME`, which must match the running agent's `AGENT_NAME`.
- **Transfers are declined:** see the transfer section above.
