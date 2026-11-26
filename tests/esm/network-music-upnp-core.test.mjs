import assert from 'node:assert/strict';
import test from 'node:test';
import { withUpnpCore } from '../../js/network-music/upnp/host-core.js';
import { parseSoapResponse, readDescription } from '../../js/network-music/upnp/protocol.js';

test('the page adapter can browse using raw description and SOAP response text', async () => {
  const type = 'urn:schemas-upnp-org:service:ContentDirectory:1';
  const description = `<root><device><UDN>uuid:library</UDN><serviceList><service>
    <serviceType>${type}</serviceType><controlURL>/control</controlURL>
  </service></serviceList></device></root>`;
  const [{ device }] = [...readDescription(description, {
    location: 'http://192.168.1.2/description.xml', id: 'uuid:library', address: '192.168.1.2', expires: 1000
  })];
  const UpnpCore = withUpnpCore();
  const core = new UpnpCore({
    discovery: { devices: new Map([[device.id, device]]) },
    invoke: async (endpoint, action, args) => {
      assert.equal(endpoint.control, 'http://192.168.1.2/control');
      assert.equal(action, 'Browse');
      assert.equal(args.ObjectID, '0');
      const response = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
        <u:BrowseResponse xmlns:u="${type}"><Result><![CDATA[
          <DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/">
            <item id="track"><dc:title>Song</dc:title></item>
          </DIDL-Lite>
        ]]></Result><TotalMatches>1</TotalMatches></u:BrowseResponse>
      </s:Body></s:Envelope>`;
      return parseSoapResponse(response, action);
    }
  });
  const page = await core.browse({ serverId: device.id });
  assert.deepEqual(page.items.map(item => [item.trackId, item.title]), [['track', 'Song']]);
  assert.equal(page.total, 1);
});
