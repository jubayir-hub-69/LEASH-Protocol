# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import genlayer as gl
from genlayer.types import *


class Contract(gl.contract.Contract):
    mandate: str
    spend_cap: u256
    deadline: u256

    def __init__(self, mandate: str, spend_cap: int, deadline: int):
        self.mandate = mandate
        self.spend_cap = spend_cap
        self.deadline = deadline
