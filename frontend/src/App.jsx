import React from 'react';
import Room from './Room';
import Chat from './components/Chat';
import Search from './components/Search';
import Home from './components/Home';
import { useSelector } from 'react-redux';

const App = () => {
  const checkuser = useSelector(state => state.user.checkuser);

  return (
    <div>
      {
        checkuser ? (
          <div>
            <Room />
          </div>
        ) : (
         <div>
            <Home />
          </div>
        )
      }
    </div>
  );
};

export default App;
