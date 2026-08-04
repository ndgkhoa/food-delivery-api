# Inventory

The inventory service has no HTTP surface — it is reachable only via gRPC
(east-west, called by the order service during the reserve/release saga
steps). There is nothing to exercise through the gateway, so this folder
intentionally has no `.bru` request files.
