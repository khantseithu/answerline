# Connect a Twilio number

This guide routes a Twilio phone number to an Answerline agent over an [Elastic SIP Trunk](https://www.twilio.com/docs/sip-trunking). Calls arrive at your LiveKit SIP service, LiveKit dispatches the agent, and the call is logged with the caller's number.

Start with [Connect a phone number](../telephony.md) for the server-side requirements (a public host for the SIP service, open ports). This page covers the Twilio side.

## What you need

- A Twilio account with a voice-capable phone number. Trial accounts can receive calls but play a trial notice first.
- Your Account SID and Auth Token (Twilio console → Account info).
- The public hostname or IP of your SIP service, reachable by Twilio on TCP 5060 and your RTP port range.
- The slug of the agent that should answer, e.g. `bright-smile-dental`.

## Option 1: setup script

Add the credentials to `.env`:

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
SIP_PUBLIC_IP=203.0.113.10
```

Then run:

```bash
pnpm sip twilio +15551234567 bright-smile-dental
```

Pass `--sip-host sip.example.com` to use a hostname instead of `SIP_PUBLIC_IP`. The script is safe to re-run. It:

1. Finds or creates an Elastic SIP Trunk named `answerline`, with call transfer (SIP REFER) enabled for SIP and PSTN targets and the caller's number shown to the transfer target.
2. Adds the origination URI `sip:<host>;transport=tcp`, so Twilio sends inbound calls to your SIP service.
3. Attaches the phone number to the trunk. It stops if the number is already on another trunk.
4. Creates the LiveKit inbound trunk and dispatch rule for the number (or reassigns the agent if the number is already connected).

Check the result with `pnpm sip list`.

## Option 2: Twilio console

1. **Create the trunk.** Elastic SIP Trunking → Manage → Trunks → Create new SIP Trunk.
2. **Enable call transfer.** On the trunk's General page, under Features → Call Transfer (SIP REFER), select Enabled, set Caller ID for Transfer Target to Transferee, and select Enable PSTN Transfer. Save. Without this, the agent's `transfer_call` tool fails and after-hours transfer falls through.
3. **Point origination at your SIP service.** Origination → Add new Origination URI: `sip:<your SIP host>;transport=tcp`, priority 1, weight 1, enabled.
4. **Attach the number.** Numbers → Add an existing number. A number on a trunk no longer uses its voice webhook or TwiML.
5. **Connect the number in Answerline:**

   ```bash
   pnpm sip add +15551234567 bright-smile-dental
   ```

   Or use the Phone numbers page in the dashboard.

The equivalent Twilio CLI calls are in the [LiveKit Twilio guide](https://docs.livekit.io/telephony/start/providers/twilio/). To turn on transfer for an existing trunk:

```bash
twilio api trunking v1 trunks update --sid <trunk-sid> --transfer-mode enable-all --transfer-caller-id from-transferee
```

## Lock down the inbound trunk (optional)

The LiveKit inbound trunk accepts calls for the number from any source. To accept only Twilio's signaling addresses, pass them when you connect the number:

```bash
pnpm sip remove +15551234567
pnpm sip add +15551234567 bright-smile-dental --allowed-address 54.172.60.0/30 --allowed-address 54.244.51.0/30
```

Use the current ranges for your Twilio edge from [Twilio's IP address list](https://www.twilio.com/docs/sip-trunking/ip-addresses). Twilio origination does not send digest credentials, so leave `--auth-username` unset for Twilio.

## Test

Call the number. You should hear the agent's greeting. After you hang up, the call is stored with `channel = sip` and your number as `from_number`.

If the call fails:

- **Fast busy or "not configured":** Twilio can't reach `sip:<host>;transport=tcp`. Check the host, that TCP 5060 is open, and the Twilio debugger (Monitor → Logs → Errors).
- **Rings, then silence or one-way audio:** RTP is blocked or the SIP service announces a private address. Set `SIP_PUBLIC_IP` and open the RTP range (UDP).
- **SIP service rejects the call:** the dialed number is not connected. Run `pnpm sip list` and check the SIP service logs (`docker compose logs sip`).
- **The agent never joins:** the dispatch rule names `AGENT_NAME`, which must match the running agent's `AGENT_NAME`.
- **Transfer fails:** check that Call Transfer (SIP REFER) and PSTN transfer are enabled on the trunk.
