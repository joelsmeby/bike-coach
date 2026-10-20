"""Calibration display adapter; shared engine owns the frame validation/math."""
import numpy as np
from .shared_engine import call


def bike_frame(ride):
    value = call("bikeFrame", {"gyro": ride.gyro.tolist(), "calibration": ride.calibration})
    return None if value is None else np.asarray(value)
