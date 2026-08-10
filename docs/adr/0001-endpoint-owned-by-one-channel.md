# Endpoint is owned by exactly one Channel

An Endpoint belongs to a single Channel; the same URL on two Channels is two Endpoint rows. Reusable multi-Channel Endpoints were rejected for the MVP: per-Channel config (timeout, headers, enabled) would need a join table or override layer, and fan-out/Attempt identity is already Broadcast × Endpoint. Single ownership keeps the model flat and matches the one-job-per-Delivery queue shape.
