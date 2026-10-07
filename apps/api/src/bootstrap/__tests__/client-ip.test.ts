import { describe, expect, it } from "vitest";

import { clientNetwork, normaliseClientIp } from "../client-ip";

describe("normaliseClientIp", () => {
  it("keys IPv6 clients by /64 and IPv4-mapped addresses as IPv4", () => {
    expect(normaliseClientIp("203.0.113.7")).toBe("203.0.113.7");
    expect(normaliseClientIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normaliseClientIp("::FFFF:cb00:7107")).toBe("203.0.113.7");
    expect(normaliseClientIp("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(normaliseClientIp("2001:0db8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(normaliseClientIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normaliseClientIp("::1")).toBe("0:0:0:0::/64");
    expect(normaliseClientIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(normaliseClientIp("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
  });

  it("puts every address of one /64 in one bucket", () => {
    expect(normaliseClientIp("2001:db8:aa:bb::1")).toBe(normaliseClientIp("2001:db8:aa:bb:ffff:ffff:ffff:ffff"));
    expect(normaliseClientIp("2001:db8:aa:bb::1")).not.toBe(normaliseClientIp("2001:db8:aa:bc::1"));
  });

  it("returns undefined for anything that isn't an IP address", () => {
    for (const value of ["", "localhost", "999.1.1.1", "2001:db8::/64", "1.2.3.4:80"]) {
      expect(normaliseClientIp(value), value).toBeUndefined();
    }
  });
});

describe("clientNetwork", () => {
  it("keys IPv6 clients by /48 as well, and leaves IPv4 to its address", () => {
    expect(clientNetwork("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1::/48");
    expect(clientNetwork("2001:0DB8:0001:ffff::1")).toBe("2001:db8:1::/48");
    expect(clientNetwork("fe80::1%eth0")).toBe("fe80:0:0::/48");
    for (const value of ["203.0.113.7", "::ffff:203.0.113.7", "", "localhost", "2001:db8::/64"]) {
      expect(clientNetwork(value), value).toBeUndefined();
    }
  });

  it("puts every /64 of one /48 in one network bucket", () => {
    expect(clientNetwork("2001:db8:aa:1::1")).toBe(clientNetwork("2001:db8:aa:ffff::1"));
    expect(normaliseClientIp("2001:db8:aa:1::1")).not.toBe(normaliseClientIp("2001:db8:aa:ffff::1"));
    expect(clientNetwork("2001:db8:aa::1")).not.toBe(clientNetwork("2001:db8:ab::1"));
  });
});
