registerEncounters({D02:{objective:'Stop collision symptoms on the SW1-to-R1 link while preserving 1 Gbps service.',evidence:"SW1# show interfaces gi0/1\nFull-duplex, 1000Mb/s\n 0 late collisions, 0 deferred\n\nR1# show interfaces gi0/0/0\nHalf-duplex, 1000Mb/s\n 18 runts, 146 late collisions, 32 deferred\n\nDesign: full duplex at 1 Gbps.",choices:['Configure R1 Gi0/0/0 for duplex full and speed 1000','Change only the IP mask to /30','Change native VLAN to 1 on the routed port','Disable spanning tree on both devices'],answer:0,analysis:'Ethernet collision symptoms indicate a duplex problem. IP masks, 802.1Q tagging, and STP are unrelated to this physical/link configuration on the routed interface.'},I02:{
  "objective": "Enable R1 Gi0/0/0 so its known-good physical link can become up/up.",
  "evidence": "R1# show ip interface brief\nInterface   IP-Address     OK? Method Status              Protocol\nGi0/0/0     192.168.5.1    YES manual administratively down down\nGi0/0/1     192.168.6.1    YES manual up                  up\n\nR1# show interfaces gi0/0/0\nGigabitEthernet0/0/0 is administratively down, line protocol is down",
  "choices": [
    "R1 Gi0/0/0: no shutdown",
    "R1 Gi0/0/0: switchport mode access",
    "R1 Gi0/0/0: ip helper-address 192.168.5.1",
    "R1 Gi0/0/0: clock rate 64000"
  ],
  "answer": 0,
  "analysis": "Only no shutdown enables the administratively disabled interface. Access VLAN, DHCP relay, and serial DCE clock rate do not address the reported state."
},
});
