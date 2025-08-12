import { createSlice } from "@reduxjs/toolkit";

const userSlice = createSlice({
  name: "checkuser",
  initialState: {
    checkuser: false,
  },
  reducers: {
    adduser: (state, action) => {
      state.checkuser = action.payload;
    },
  },
});

export const { adduser } = userSlice.actions;
export default userSlice.reducer;
